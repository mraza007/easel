import { toPng } from "html-to-image";

/**
 * RPC handlers run when the MCP server asks the canvas for something only the
 * live DOM knows: resolved styles or pixels. Each handler takes typed params
 * and returns a JSON-serializable result (or a base64 string for binary).
 */

interface HandlerMap {
  get_computed_styles: (params: {
    nodeId: string;
    properties?: string[];
  }) => Promise<Record<string, string>>;
  get_screenshot: (params: {
    nodeId: string;
    scale?: number;
  }) => Promise<{ mimeType: string; data: string; width: number; height: number }>;
  get_bounding_rect: (params: {
    nodeId: string;
  }) => Promise<{ x: number; y: number; width: number; height: number }>;
}

export type RpcMethod = keyof HandlerMap;

const DEFAULT_PROPS = [
  "color",
  "background-color",
  "background",
  "background-image",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "padding",
  "margin",
  "border",
  "border-radius",
  "box-shadow",
  "display",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "width",
  "height",
  "max-width",
  "min-width",
  "max-height",
  "min-height",
  "opacity",
  "transform",
];

export const handlers: HandlerMap = {
  async get_computed_styles({ nodeId, properties }) {
    const el = findNode(nodeId);
    const style = window.getComputedStyle(el);
    const out: Record<string, string> = {};
    const props = properties ?? DEFAULT_PROPS;
    for (const p of props) {
      const value = style.getPropertyValue(p);
      if (value) out[p] = value.trim();
    }
    return out;
  },

  async get_screenshot({ nodeId, scale = 1 }) {
    const el = findNode(nodeId) as HTMLElement;
    const rect = el.getBoundingClientRect();
    const dataUrl = await toPng(el, {
      pixelRatio: scale,
      cacheBust: true,
    });
    // dataUrl is "data:image/png;base64,...."
    const comma = dataUrl.indexOf(",");
    const data = comma === -1 ? "" : dataUrl.slice(comma + 1);
    return {
      mimeType: "image/png",
      data,
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    };
  },

  async get_bounding_rect({ nodeId }) {
    const el = findNode(nodeId);
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  },
};

function findNode(nodeId: string): Element {
  const el = document.querySelector(`[data-easel-id="${cssEscape(nodeId)}"]`);
  if (!el) throw new Error(`Node not found in DOM: ${nodeId}`);
  return el;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  // Minimal fallback: escape characters that are dangerous in attribute selectors.
  return value.replace(/(["'\\\]])/g, "\\$1");
}

export async function dispatch(method: string, params: unknown): Promise<unknown> {
  const handler = (handlers as unknown as Record<string, (p: unknown) => Promise<unknown>>)[
    method
  ];
  if (!handler) throw new Error(`Unknown RPC method: ${method}`);
  return handler(params);
}
