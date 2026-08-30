// Markdown -> mdast (via remark) -> real docx constructs, walked by hand rather
// than delegated to a generic HTML-to-docx converter, so headings/lists/tables
// map onto genuine Word formatting (real heading styles, real list numbering,
// real tables) instead of one flat paragraph of escaped Markdown. API shapes
// below (bullet/numbering paragraph options, ExternalHyperlink, shading,
// style-id overrides) were confirmed directly against the installed docx
// package's type definitions, not guessed.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, ListItem, List } from "mdast";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  LevelFormat,
  ShadingType,
  HeadingLevel,
  type ParagraphChild,
} from "docx";

const ORDERED_REF = "magi-ordered-list";
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const RULE_BORDER = { style: BorderStyle.SINGLE, size: 6, color: "999999" as const };
const HEADER_SHADING = { fill: "EDEDED", type: ShadingType.CLEAR, color: "auto" as const };
const CODE_SHADING = { fill: "F5F5F5", type: ShadingType.CLEAR, color: "auto" as const };

interface Style {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function run(text: string, style: Style): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? "Consolas" : undefined,
  });
}

// Walks inline (phrasing) content, accumulating style flags through nested
// strong/emphasis/delete so "**bold *and italic***" produces one run with
// both flags set, not two separately-styled runs.
function inlineChildren(nodes: PhrasingContent[] | undefined, style: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
        out.push(run(node.value, style));
        break;
      case "strong":
        out.push(...inlineChildren(node.children, { ...style, bold: true }));
        break;
      case "emphasis":
        out.push(...inlineChildren(node.children, { ...style, italics: true }));
        break;
      case "delete":
        out.push(...inlineChildren(node.children, { ...style, strike: true }));
        break;
      case "inlineCode":
        out.push(run(node.value, { ...style, code: true }));
        break;
      case "link":
        out.push(new ExternalHyperlink({ children: inlineChildren(node.children, style), link: node.url }));
        break;
      case "break":
        out.push(new TextRun({ break: 1 }));
        break;
      default: {
        // Unrecognized inline node (e.g. an image) — never throw, just skip
        // it or fall back to any raw text it carries.
        const value = (node as { value?: unknown }).value;
        if (typeof value === "string") out.push(run(value, style));
      }
    }
  }
  return out;
}

function listItemParagraphs(item: ListItem, ordered: boolean, level: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of item.children) {
    if (child.type === "paragraph") {
      out.push(
        new Paragraph({
          children: inlineChildren(child.children),
          ...(ordered ? { numbering: { reference: ORDERED_REF, level } } : { bullet: { level } }),
        })
      );
    } else if (child.type === "list") {
      out.push(...listBlock(child, level + 1));
    } else {
      out.push(...blockToContent(child));
    }
  }
  return out;
}

function listBlock(node: List, level = 0): (Paragraph | Table)[] {
  return node.children.flatMap((item) => listItemParagraphs(item, !!node.ordered, level));
}

function tableBlock(node: Extract<RootContent, { type: "table" }>): Table {
  const rows = node.children.map(
    (row, rowIndex) =>
      new TableRow({
        children: row.children.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: inlineChildren(cell.children, rowIndex === 0 ? { bold: true } : {}) })],
              shading: rowIndex === 0 ? HEADER_SHADING : undefined,
            })
        ),
      })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function codeBlock(node: Extract<RootContent, { type: "code" }>): Paragraph[] {
  const lines = node.value.split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [run(line || " ", { code: true })],
        shading: CODE_SHADING,
        spacing: i === 0 ? { before: 160 } : i === lines.length - 1 ? { after: 160 } : undefined,
      })
  );
}

function blockquoteBlock(node: Extract<RootContent, { type: "blockquote" }>): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of node.children) {
    if (child.type === "paragraph") {
      out.push(
        new Paragraph({
          children: inlineChildren(child.children, { italics: true }),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "AAAAAA", space: 8 } },
        })
      );
    } else {
      out.push(...blockToContent(child));
    }
  }
  return out;
}

function blockToContent(node: RootContent): (Paragraph | Table)[] {
  switch (node.type) {
    case "heading":
      return [new Paragraph({ heading: HEADINGS[node.depth - 1], children: inlineChildren(node.children) })];
    case "paragraph":
      return [new Paragraph({ children: inlineChildren(node.children), spacing: { after: 160 } })];
    case "list":
      return listBlock(node);
    case "table":
      return [tableBlock(node)];
    case "blockquote":
      return blockquoteBlock(node);
    case "code":
      return codeBlock(node);
    case "thematicBreak":
      return [new Paragraph({ border: { bottom: RULE_BORDER }, spacing: { before: 200, after: 200 } })];
    default:
      return [];
  }
}

function headingStyle(id: string, size: number) {
  return {
    id,
    name: id,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
    run: { bold: true, size, color: "1F3864" },
    paragraph: { spacing: { before: 240, after: 120 } },
  };
}

export async function markdownToDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const children = tree.children.flatMap((node) => {
    try {
      return blockToContent(node);
    } catch {
      return [];
    }
  });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: ORDERED_REF,
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { size: 22, color: "1A1A1A" } },
      },
      paragraphStyles: [
        headingStyle("Heading1", 32),
        headingStyle("Heading2", 28),
        headingStyle("Heading3", 26),
        headingStyle("Heading4", 24),
        headingStyle("Heading5", 22),
        headingStyle("Heading6", 22),
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ text: title })] }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
