// Markdown -> mdast (via remark, same parser markdownToDocx.ts uses for the
// Word-export path) -> React elements, walked by hand for the same reason
// that file walks it by hand: headings/lists/tables/links need to become
// real semantic elements, not one escaped blob of text. Keep the two walkers
// structurally in sync if either one's node-type coverage changes.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, ListItem, List } from "mdast";
import type { ReactNode } from "react";

function inlineChildren(nodes: PhrasingContent[] | undefined, keyPrefix: string): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return <strong key={key}>{inlineChildren(node.children, key)}</strong>;
      case "emphasis":
        return <em key={key}>{inlineChildren(node.children, key)}</em>;
      case "delete":
        return <del key={key}>{inlineChildren(node.children, key)}</del>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "link":
        return (
          <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
            {inlineChildren(node.children, key)}
          </a>
        );
      case "break":
        return <br key={key} />;
      default: {
        const value = (node as { value?: unknown }).value;
        return typeof value === "string" ? value : null;
      }
    }
  });
}

function listItemContent(item: ListItem, keyPrefix: string): ReactNode[] {
  return item.children.map((child, i) => {
    const key = `${keyPrefix}-${i}`;
    if (child.type === "paragraph") return <span key={key}>{inlineChildren(child.children, key)}</span>;
    if (child.type === "list") return listBlock(child, key);
    return blockToNode(child, key);
  });
}

function listBlock(node: List, key: string): ReactNode {
  const items = node.children.map((item, i) => <li key={`${key}-${i}`}>{listItemContent(item, `${key}-${i}`)}</li>);
  return node.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function tableBlock(node: Extract<RootContent, { type: "table" }>, key: string): ReactNode {
  const [headerRow, ...bodyRows] = node.children;
  return (
    <table key={key}>
      {headerRow && (
        <thead>
          <tr>
            {headerRow.children.map((cell, i) => (
              <th key={i}>{inlineChildren(cell.children, `${key}-h${i}`)}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map((row, ri) => (
          <tr key={ri}>
            {row.children.map((cell, ci) => (
              <td key={ci}>{inlineChildren(cell.children, `${key}-${ri}-${ci}`)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function blockToNode(node: RootContent, key: string): ReactNode {
  switch (node.type) {
    case "heading": {
      const HeadingTag = `h${Math.min(node.depth, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <HeadingTag key={key}>{inlineChildren(node.children, key)}</HeadingTag>;
    }
    case "paragraph":
      return <p key={key}>{inlineChildren(node.children, key)}</p>;
    case "list":
      return listBlock(node, key);
    case "table":
      return tableBlock(node, key);
    case "blockquote":
      return <blockquote key={key}>{node.children.map((child, i) => blockToNode(child, `${key}-${i}`))}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case "thematicBreak":
      return <hr key={key} />;
    default:
      return null;
  }
}

function parseToNodes(markdown: string): ReactNode {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  return tree.children.map((node, i) => {
    try {
      return blockToNode(node, `b${i}`);
    } catch {
      return null;
    }
  });
}

// A conversation re-renders its whole message list whenever anything about it
// changes — a scroll position, an open branch panel, a finished turn — and
// every assistant message in it calls this. Parsing a hundred replies again to
// produce elements identical to the ones already on screen was the single
// most expensive thing the conversation view did.
//
// Keyed by the markdown itself, so a message that hasn't changed is free and
// an edited one re-parses on its own. The elements handed back are React
// elements — immutable by contract — so returning the same ones is not just
// safe but the point: React sees the identical element reference and skips
// re-rendering that subtree entirely.
const RENDER_CACHE_LIMIT = 400;
const renderCache = new Map<string, ReactNode>();

export function renderMarkdown(markdown: string): ReactNode {
  const cached = renderCache.get(markdown);
  if (cached !== undefined) {
    // Re-insert to make this the most recently used entry — a long
    // conversation being scrolled must not evict the messages in view.
    renderCache.delete(markdown);
    renderCache.set(markdown, cached);
    return cached;
  }
  const rendered = parseToNodes(markdown);
  renderCache.set(markdown, rendered);
  if (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next();
    if (!oldest.done) renderCache.delete(oldest.value);
  }
  return rendered;
}
