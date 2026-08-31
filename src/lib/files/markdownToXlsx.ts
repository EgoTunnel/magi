// Markdown -> mdast (via remark, same parser markdownToDocx.ts uses) -> a
// real .xlsx workbook, walked by hand for the same reason that file is:
// headings/lists/tables need to become genuine spreadsheet structure, not
// one escaped blob of text in cell A1. Content flows down a single
// worksheet in document order (mirroring docx's own single-flow model)
// rather than splitting into multiple sheets — GFM tables are the one place
// this actually matters, and they get real multi-column rows with
// type-aware (numeric vs text) cell values, a bold+shaded header row, and
// auto-sized columns.
import ExcelJS from "exceljs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, List } from "mdast";

const MAX_COL_WIDTH = 60;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
const CELL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};
// Roughly matches the heading-size ladder in markdownToDocx.ts's HEADINGS
// array, just expressed as point sizes instead of Word heading styles.
const HEADING_SIZES = [16, 14, 13, 12, 11, 11];

interface Style {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

function fontFor(style: Style, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> | undefined {
  const font: Partial<ExcelJS.Font> = { ...extra };
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.strike) font.strike = true;
  if (style.code) font.name = "Consolas";
  return Object.keys(font).length ? font : undefined;
}

// Walks inline (phrasing) content into ExcelJS rich-text runs, accumulating
// style flags through nested strong/emphasis/delete exactly like
// markdownToDocx.ts's inlineChildren() does for docx TextRuns. Links render
// as plain styled text (blue/underline) rather than a real clickable
// hyperlink — ExcelJS's hyperlink cell type applies to a whole cell, not an
// individual run within richText, and a cell mixing prose with an inline
// link is the uncommon case for spreadsheet content.
function richRuns(nodes: PhrasingContent[] | undefined, style: Style = {}, extra: Partial<ExcelJS.Font> = {}): ExcelJS.RichText[] {
  const out: ExcelJS.RichText[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
        out.push({ text: node.value, font: fontFor(style, extra) });
        break;
      case "strong":
        out.push(...richRuns(node.children, { ...style, bold: true }, extra));
        break;
      case "emphasis":
        out.push(...richRuns(node.children, { ...style, italic: true }, extra));
        break;
      case "delete":
        out.push(...richRuns(node.children, { ...style, strike: true }, extra));
        break;
      case "inlineCode":
        out.push({ text: node.value, font: fontFor({ ...style, code: true }, extra) });
        break;
      case "link":
        out.push(...richRuns(node.children, style, { ...extra, underline: true, color: { argb: "FF1155CC" } }));
        break;
      case "break":
        out.push({ text: "\n" });
        break;
      default: {
        const value = (node as { value?: unknown }).value;
        if (typeof value === "string") out.push({ text: value, font: fontFor(style, extra) });
      }
    }
  }
  return out;
}

function plainText(runs: ExcelJS.RichText[]): string {
  return runs.map((r) => r.text).join("");
}

function track(colWidths: number[], colIndex: number, length: number) {
  colWidths[colIndex] = Math.max(colWidths[colIndex] ?? 8, Math.min(length + 2, MAX_COL_WIDTH));
}

function cellValueFor(runs: ExcelJS.RichText[]): ExcelJS.CellValue {
  if (runs.length === 1 && !runs[0].font) return runs[0].text;
  return { richText: runs };
}

function parseNumeric(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function addSingleCellRow(ws: ExcelJS.Worksheet, runs: ExcelJS.RichText[], colWidths: number[], indent?: number) {
  const plain = plainText(runs);
  const row = ws.addRow([]);
  if (!plain.trim()) return row;
  const cell = row.getCell(1);
  cell.value = cellValueFor(runs);
  if (indent) cell.alignment = { indent };
  track(colWidths, 0, plain.length);
  return row;
}

function listRows(ws: ExcelJS.Worksheet, node: List, colWidths: number[], level: number) {
  node.children.forEach((item, i) => {
    const marker = node.ordered ? `${(node.start ?? 1) + i}.` : "•";
    const prefix = `${"    ".repeat(level)}${marker} `;
    for (const child of item.children) {
      if (child.type === "paragraph") {
        addSingleCellRow(ws, [{ text: prefix }, ...richRuns(child.children)], colWidths);
      } else if (child.type === "list") {
        listRows(ws, child, colWidths, level + 1);
      } else {
        blockToRows(ws, child, colWidths);
      }
    }
  });
}

function tableRows(ws: ExcelJS.Worksheet, node: Extract<RootContent, { type: "table" }>, colWidths: number[]) {
  node.children.forEach((row, rowIndex) => {
    const wsRow = ws.addRow([]);
    row.children.forEach((cell, colIndex) => {
      const runs = richRuns(cell.children, rowIndex === 0 ? { bold: true } : {});
      const plain = plainText(runs);
      const wsCell = wsRow.getCell(colIndex + 1);
      const numeric = rowIndex > 0 ? parseNumeric(plain) : null;
      wsCell.value = numeric !== null ? numeric : cellValueFor(runs);
      wsCell.border = CELL_BORDER;
      if (rowIndex === 0) {
        wsCell.font = { bold: true };
        wsCell.fill = HEADER_FILL;
      }
      track(colWidths, colIndex, plain.length);
    });
  });
}

function blockToRows(ws: ExcelJS.Worksheet, node: RootContent, colWidths: number[]) {
  switch (node.type) {
    case "heading":
      addSingleCellRow(ws, richRuns(node.children, {}, { bold: true, size: HEADING_SIZES[Math.min(node.depth - 1, 5)] }), colWidths);
      break;
    case "paragraph":
      addSingleCellRow(ws, richRuns(node.children), colWidths);
      break;
    case "list":
      listRows(ws, node, colWidths, 0);
      break;
    case "table":
      tableRows(ws, node, colWidths);
      break;
    case "blockquote":
      for (const child of node.children) {
        if (child.type === "paragraph") addSingleCellRow(ws, richRuns(child.children, { italic: true }), colWidths, 1);
        else blockToRows(ws, child, colWidths);
      }
      break;
    case "code":
      for (const line of node.value.split("\n")) {
        addSingleCellRow(ws, [{ text: line || " ", font: { name: "Consolas", size: 10 } }], colWidths);
      }
      break;
    case "thematicBreak":
      ws.addRow([]);
      break;
    default:
      break;
  }
}

export async function markdownToXlsxBuffer(markdown: string, title: string): Promise<Buffer> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const workbook = new ExcelJS.Workbook();
  const sheetName = title.replace(/[\\/*?:[\]]/g, "").slice(0, 31).trim() || "Sheet1";
  const ws = workbook.addWorksheet(sheetName);

  const colWidths: number[] = [];
  for (const node of tree.children) {
    try {
      blockToRows(ws, node, colWidths);
    } catch {
      // Skip a node the walker doesn't know how to render rather than
      // failing the whole document over it.
    }
  }
  if (ws.rowCount === 0) addSingleCellRow(ws, [{ text: title }], colWidths);
  colWidths.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
