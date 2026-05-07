import type { PaperNode } from "./types.js";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Emit a JSX string from a PaperNode tree. Used by the get_jsx MCP tool so the
 * agent can copy structure into the user's repo. Styles are emitted as inline
 * objects; the agent can then translate to className-based styling using the
 * design system if desired.
 */
export function emitJsx(node: PaperNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const tag = node.tag === "artboard" ? "div" : node.tag;
  const styleStr = node.styles ? ` style={${formatStyleObject(node.styles)}}` : "";
  const attrStr = node.attrs ? formatAttrs(node.attrs) : "";

  if (VOID_TAGS.has(tag)) {
    return `${pad}<${tag}${attrStr}${styleStr} />`;
  }

  if (
    node.text !== undefined &&
    (!node.children || node.children.length === 0)
  ) {
    return `${pad}<${tag}${attrStr}${styleStr}>${escapeJsxText(node.text)}</${tag}>`;
  }

  const childParts: string[] = [];
  if (node.text !== undefined) childParts.push(`${"  ".repeat(indent + 1)}${escapeJsxText(node.text)}`);
  if (node.children) {
    for (const c of node.children) childParts.push(emitJsx(c, indent + 1));
  }

  if (childParts.length === 0) {
    return `${pad}<${tag}${attrStr}${styleStr} />`;
  }

  return `${pad}<${tag}${attrStr}${styleStr}>\n${childParts.join("\n")}\n${pad}</${tag}>`;
}

function formatStyleObject(styles: Record<string, string | number>): string {
  const entries = Object.entries(styles).map(([k, v]) => {
    const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
    const value = typeof v === "number" ? String(v) : JSON.stringify(v);
    return `${key}: ${value}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function formatAttrs(attrs: Record<string, string>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const jsxKey = k === "class" ? "className" : k === "for" ? "htmlFor" : k;
    out.push(` ${jsxKey}=${JSON.stringify(v)}`);
  }
  return out.join("");
}

function escapeJsxText(text: string): string {
  return text.replace(/[{}<>]/g, (c) => `{"${c}"}`);
}
