// Markdown -> mdast (via remark, same parser markdownToDocx.ts uses) -> a
// real .pptx deck. Word and Excel both have native top-to-bottom flow
// layout that the docx/xlsx walkers can just append into; PowerPoint has
// none — every shape needs an explicit x/y/w/h — so this walker also carries
// a running vertical cursor per slide and starts a continuation slide
// whenever the next block would run off the bottom. That estimation is
// necessarily approximate (real text wrapping depends on font metrics this
// module doesn't have access to), so it errs generous rather than tight.
//
// Slide breaks: a level-1 heading (`# Heading`) or a thematic break (`---`)
// starts a new slide. A slide whose first block is a `#` heading uses that
// heading's text as its title (removed from the body so it isn't rendered
// twice); anything else uses the artifact's own title only for the very
// first slide, and no title otherwise. Tables use PptxGenJS's own
// `autoPage` so a table taller than one slide splits itself correctly
// without this module's height estimate needing to be exact.
import PptxGenJS from "pptxgenjs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, List } from "mdast";

// LAYOUT_WIDE is PptxGenJS's built-in 13.33" x 7.5" slide size.
const SLIDE_W = 13.33;
const MARGIN_X = 0.6;
const TITLE_Y = 0.45;
const TITLE_H = 0.9;
const BODY_START_Y = 1.55;
const MAX_Y = 6.9;
const BODY_W = SLIDE_W - MARGIN_X * 2;
const HEADING_SIZES = [26, 22, 19, 16, 14, 14];
const BODY_SIZE = 16;

interface Style {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

interface SlideGroup {
  title: string | null;
  body: RootContent[];
}

function plainTextOf(nodes: PhrasingContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text" || n.type === "inlineCode") return n.value;
      if (n.type === "break") return "\n";
      if ("children" in n) return plainTextOf(n.children as PhrasingContent[]);
      return "";
    })
    .join("");
}

// One line "costs" a fraction of an inch at BODY_SIZE-ish text — a rough
// stand-in for real text metrics, deliberately generous (see file header).
function estimateTextHeight(text: string, fontSize: number, indentChars = 0): number {
  const perLine = Math.max(20, Math.floor(1400 / fontSize) - indentChars);
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return lines * (fontSize / 72) * 1.5;
}

function estimateListHeight(node: List, level = 0): number {
  let height = 0;
  for (const item of node.children) {
    for (const child of item.children) {
      if (child.type === "paragraph") height += estimateTextHeight(plainTextOf(child.children), BODY_SIZE, level * 4);
      else if (child.type === "list") height += estimateListHeight(child, level + 1);
    }
  }
  return height;
}

function estimateBlockHeight(node: RootContent): number {
  switch (node.type) {
    case "heading":
      return estimateTextHeight(plainTextOf(node.children), HEADING_SIZES[Math.min(node.depth - 1, 5)]) + 0.2;
    case "paragraph":
      return estimateTextHeight(plainTextOf(node.children), BODY_SIZE) + 0.15;
    case "list":
      return estimateListHeight(node) + 0.15;
    case "table":
      return node.children.length * 0.35 + 0.25;
    case "blockquote":
      return node.children.reduce(
        (sum, c) => sum + (c.type === "paragraph" ? estimateTextHeight(plainTextOf(c.children), BODY_SIZE) : 0.3),
        0.15
      );
    case "code":
      return node.value.split("\n").length * 0.24 + 0.15;
    case "thematicBreak":
      return 0;
    default:
      return 0.3;
  }
}

// Mirrors markdownToDocx.ts's inlineChildren()/markdownToXlsx.ts's
// richRuns() — same recursive style-accumulation walk over PhrasingContent,
// this time emitting PptxGenJS.TextProps runs. Links render as underlined,
// accent-colored text rather than a real hyperlink: PptxGenJS's
// HyperlinkProps type requires an internal `_rId` field that's meant to be
// assigned by the library itself, not constructed by callers, so building
// one directly here would fight the types for a rarely-needed feature in
// slide body text.
function inlineRuns(
  nodes: PhrasingContent[] | undefined,
  style: Style = {},
  extra: Partial<PptxGenJS.TextPropsOptions> = {}
): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text":
        out.push({ text: node.value, options: optionsFor(style, extra) });
        break;
      case "strong":
        out.push(...inlineRuns(node.children, { ...style, bold: true }, extra));
        break;
      case "emphasis":
        out.push(...inlineRuns(node.children, { ...style, italic: true }, extra));
        break;
      case "delete":
        out.push(...inlineRuns(node.children, { ...style, strike: true }, extra));
        break;
      case "inlineCode":
        out.push({ text: node.value, options: optionsFor({ ...style, code: true }, extra) });
        break;
      case "link":
        out.push(...inlineRuns(node.children, style, { ...extra, underline: { style: "sng" }, color: "1155CC" }));
        break;
      case "break":
        out.push({ text: "", options: { ...extra, breakLine: true } });
        break;
      default: {
        const value = (node as { value?: unknown }).value;
        if (typeof value === "string") out.push({ text: value, options: optionsFor(style, extra) });
      }
    }
  }
  return out;
}

function optionsFor(style: Style, extra: Partial<PptxGenJS.TextPropsOptions>): PptxGenJS.TextPropsOptions {
  const opts: PptxGenJS.TextPropsOptions = { ...extra };
  if (style.bold) opts.bold = true;
  if (style.italic) opts.italic = true;
  if (style.strike) opts.strike = true;
  if (style.code) opts.fontFace = "Consolas";
  return opts;
}

function listTextRuns(node: List, level: number): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  const bullet: PptxGenJS.TextBaseProps["bullet"] = node.ordered ? { type: "number" } : true;
  for (const item of node.children) {
    for (const child of item.children) {
      if (child.type === "paragraph") {
        const runs = inlineRuns(child.children);
        if (runs.length === 0) runs.push({ text: " " });
        runs.forEach((run, i) => {
          out.push({
            text: run.text,
            options: { ...run.options, bullet, indentLevel: level, breakLine: i === runs.length - 1 },
          });
        });
      } else if (child.type === "list") {
        out.push(...listTextRuns(child, level + 1));
      }
    }
  }
  return out;
}

function tablePropsFor(node: Extract<RootContent, { type: "table" }>): PptxGenJS.TableRow[] {
  return node.children.map((row, rowIndex) =>
    row.children.map(
      (cell): PptxGenJS.TableCell => ({
        text: plainTextOf(cell.children) || " ",
        options:
          rowIndex === 0
            ? { bold: true, fill: { color: "EDEDED" }, fontFace: "Arial", fontSize: 13 }
            : { fontFace: "Arial", fontSize: 13 },
      })
    )
  );
}

// Renders one block onto `slide` at vertical position `y`, returning the
// cursor position for the next block. Table height doesn't need to be
// exact — see file header on autoPage.
function renderBlock(slide: PptxGenJS.Slide, node: RootContent, y: number): number {
  switch (node.type) {
    case "heading": {
      const size = HEADING_SIZES[Math.min(node.depth - 1, 5)];
      const h = estimateTextHeight(plainTextOf(node.children), size) + 0.2;
      slide.addText(inlineRuns(node.children, { bold: true }), {
        x: MARGIN_X,
        y,
        w: BODY_W,
        h,
        fontFace: "Arial",
        fontSize: size,
        color: "1F3864",
        valign: "top",
      });
      return y + h;
    }
    case "paragraph": {
      const h = estimateTextHeight(plainTextOf(node.children), BODY_SIZE) + 0.15;
      slide.addText(inlineRuns(node.children), {
        x: MARGIN_X,
        y,
        w: BODY_W,
        h,
        fontFace: "Arial",
        fontSize: BODY_SIZE,
        valign: "top",
      });
      return y + h;
    }
    case "list": {
      const h = estimateListHeight(node) + 0.15;
      slide.addText(listTextRuns(node, 0), {
        x: MARGIN_X,
        y,
        w: BODY_W,
        h,
        fontFace: "Arial",
        fontSize: BODY_SIZE,
        valign: "top",
      });
      return y + h;
    }
    case "table": {
      const rows = tablePropsFor(node);
      const h = rows.length * 0.35 + 0.25;
      slide.addTable(rows, {
        x: MARGIN_X,
        y,
        w: BODY_W,
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageHeaderRows: 1,
        border: { type: "solid", color: "CCCCCC", pt: 1 },
      });
      return y + h;
    }
    case "blockquote": {
      let cursor = y;
      for (const child of node.children) {
        if (child.type !== "paragraph") continue;
        const h = estimateTextHeight(plainTextOf(child.children), BODY_SIZE) + 0.15;
        slide.addText(inlineRuns(child.children, { italic: true }), {
          x: MARGIN_X + 0.3,
          y: cursor,
          w: BODY_W - 0.3,
          h,
          fontFace: "Arial",
          fontSize: BODY_SIZE,
          color: "555555",
          valign: "top",
        });
        cursor += h;
      }
      return cursor;
    }
    case "code": {
      const lines = node.value.split("\n");
      const h = lines.length * 0.24 + 0.15;
      const runs: PptxGenJS.TextProps[] = lines.map((line, i) => ({
        text: line || " ",
        options: { breakLine: i < lines.length - 1 },
      }));
      slide.addText(runs, {
        x: MARGIN_X,
        y,
        w: BODY_W,
        h,
        fontFace: "Consolas",
        fontSize: 12,
        fill: { color: "F5F5F5" },
        valign: "top",
      });
      return y + h;
    }
    default:
      return y;
  }
}

function renderGroup(pres: PptxGenJS, group: SlideGroup) {
  let slide = pres.addSlide();
  let cursorY = BODY_START_Y;
  if (group.title) {
    slide.addText(group.title, {
      x: MARGIN_X,
      y: TITLE_Y,
      w: BODY_W,
      h: TITLE_H,
      fontFace: "Arial",
      fontSize: 28,
      bold: true,
      color: "1F3864",
      valign: "top",
    });
  } else {
    cursorY = TITLE_Y;
  }

  for (const node of group.body) {
    const estimated = estimateBlockHeight(node);
    if (cursorY + estimated > MAX_Y && cursorY > TITLE_Y) {
      slide = pres.addSlide();
      cursorY = TITLE_Y;
    }
    cursorY = renderBlock(slide, node, cursorY);
  }
}

function groupIntoSlides(children: RootContent[], docTitle: string): SlideGroup[] {
  const groups: SlideGroup[] = [];
  let current: RootContent[] = [];

  function flush() {
    if (current.length === 0) return;
    let title: string | null = null;
    let body = current;
    const first = current[0];
    if (first.type === "heading" && first.depth === 1) {
      title = plainTextOf(first.children);
      body = current.slice(1);
    }
    groups.push({ title, body });
    current = [];
  }

  for (const node of children) {
    if (node.type === "thematicBreak") {
      flush();
      continue;
    }
    if (node.type === "heading" && node.depth === 1 && current.length > 0) {
      flush();
    }
    current.push(node);
  }
  flush();

  if (groups.length === 0) groups.push({ title: docTitle, body: [] });
  if (groups[0].title === null) groups[0].title = docTitle;
  return groups;
}

export async function markdownToPptxBuffer(markdown: string, title: string): Promise<Buffer> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const groups = groupIntoSlides(tree.children, title);

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = title;

  for (const group of groups) {
    try {
      renderGroup(pres, group);
    } catch {
      // Skip a slide group the walker doesn't know how to render rather
      // than failing the whole deck over it.
    }
  }

  const data = await pres.write({ outputType: "nodebuffer" });
  return Buffer.from(data as Uint8Array);
}
