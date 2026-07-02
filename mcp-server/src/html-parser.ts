import { parse, HTMLElement, TextNode, type Node as HtmlNode } from "node-html-parser";
import type { PaperNode, StyleObject } from "./types.js";

let idCounter = 0;
function generateId(prefix = "n") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Parse an HTML fragment into a tree of PaperNodes. Inline `style` attributes
 * are converted to camelCased style objects. `layer-name` is hoisted to
 * `layerName`. Other attributes pass through as `attrs`.
 */
export function parseHtmlFragment(html: string): PaperNode[] {
  const root = parse(html, {
    lowerCaseTagName: false,
    // Standard void tags must be declared or the parser drops unclosed
    // <img>/<br>/<input> nodes entirely.
    voidTag: {
      tags: ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"],
      closingSlash: true,
    },
  });
  const out: PaperNode[] = [];
  for (const child of root.childNodes) {
    const converted = convert(child);
    if (converted) out.push(converted);
  }
  return out;
}

/**
 * Tags the canvas will render. Anything else (script, iframe, style, object,
 * svg, custom elements) is dropped with its subtree — write_html input comes
 * from an agent and must not be able to execute in the canvas page.
 */
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br",
  "button", "caption", "code", "dd", "details", "div", "dl", "dt", "em",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "i", "img", "input", "label", "legend",
  "li", "main", "mark", "nav", "ol", "option", "p", "picture", "pre",
  "section", "select", "small", "source", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr",
  "u", "ul", "video",
]);

/** Attributes that can carry a URL — checked against dangerous schemes. */
const URL_ATTRS = new Set(["href", "src", "poster", "action", "formaction"]);

function isDangerousUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html");
}

function sanitizeAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const key = k.toLowerCase();
    if (key.startsWith("on") || key === "srcdoc") continue;
    if (URL_ATTRS.has(key) && isDangerousUrl(v)) continue;
    out[k] = v;
  }
  return out;
}

function convert(node: HtmlNode): PaperNode | null {
  if (node instanceof HTMLElement) {
    const tag = (node.rawTagName || "div").toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return null;
    const attrs = sanitizeAttrs(node.attributes);
    const styleAttr = attrs.style;
    delete attrs.style;
    const layerName = attrs["layer-name"];
    delete attrs["layer-name"];

    const children: PaperNode[] = [];
    let text: string | undefined;
    const rawChildren = node.childNodes;

    // If the element has only text-node children, collapse to .text.
    const allText = rawChildren.length > 0 && rawChildren.every((c) => c instanceof TextNode);
    if (allText) {
      const collected = rawChildren.map((c) => c.text).join("").trim();
      if (collected.length > 0) text = collected;
    } else {
      for (const c of rawChildren) {
        if (c instanceof TextNode) {
          const trimmed = c.text.trim();
          if (trimmed) {
            children.push({
              id: generateId("text"),
              tag: "span",
              text: trimmed,
            });
          }
        } else {
          const converted = convert(c);
          if (converted) children.push(converted);
        }
      }
    }

    const idAttr = attrs.id;
    delete attrs.id;

    const result: PaperNode = {
      id: idAttr || generateId(tag),
      tag,
      ...(styleAttr ? { styles: parseStyle(styleAttr) } : {}),
      ...(layerName ? { layerName } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(children.length > 0 ? { children } : {}),
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    };
    return result;
  }

  if (node instanceof TextNode) {
    const trimmed = node.text.trim();
    if (!trimmed) return null;
    return { id: generateId("text"), tag: "span", text: trimmed };
  }

  return null;
}

/** Parse `"background: red; padding: 12px"` -> { background: "red", padding: "12px" }. */
export function parseStyle(s: string): StyleObject {
  const out: StyleObject = {};
  for (const decl of s.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    out[toCamel(prop)] = value;
  }
  return out;
}

function toCamel(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
