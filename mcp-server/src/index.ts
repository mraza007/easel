#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { canvas } from "./state.js";
import { SEED_ARTBOARDS } from "./sample.js";
import { startBridge } from "./ws-bridge.js";
import { parseHtmlFragment, parseStyle } from "./html-parser.js";
import { emitJsx } from "./jsx-emit.js";
import { rpc } from "./rpc.js";
import { loadIfExists, startAutosave } from "./persistence.js";
import { scanProject, type DesignSystem } from "@easel/ds-scanner";
import type { Artboard, PaperNode } from "./types.js";

// ---------- design-system cache ----------
// The scanner runs once at startup. v2 will watch for changes.
const PROJECT_ROOT = process.env.EASEL_PROJECT_ROOT ?? process.cwd();
let designSystem: DesignSystem | null = null;
async function refreshDS() {
  designSystem = await scanProject(PROJECT_ROOT);
}

// ---------- tool schemas ----------
const CreateArtboardArgs = z.object({
  name: z.string(),
  styles: z.record(z.union([z.string(), z.number()])).default({}),
  x: z.number().optional(),
  y: z.number().optional(),
});

const WriteHtmlArgs = z.object({
  targetNodeId: z.string(),
  mode: z.enum(["insert-children", "replace"]),
  html: z.string(),
});

const UpdateStylesArgs = z.object({
  updates: z.array(
    z.object({
      nodeIds: z.array(z.string()),
      styles: z.record(z.union([z.string(), z.number()])),
    }),
  ),
});

const GetJsxArgs = z.object({ nodeId: z.string() });
const GetNodeInfoArgs = z.object({ nodeId: z.string() });
const DeleteNodeArgs = z.object({ nodeId: z.string() });
const SetSelectionArgs = z.object({ nodeId: z.string().nullable() });
const SetTextArgs = z.object({ nodeId: z.string(), text: z.string() });
const SetLayerNameArgs = z.object({ nodeId: z.string(), layerName: z.string() });
const SetDocumentNameArgs = z.object({ name: z.string() });
const DuplicateArtboardArgs = z.object({ nodeId: z.string() });

const GetComputedStylesArgs = z.object({
  nodeId: z.string(),
  properties: z.array(z.string()).optional(),
});

const GetScreenshotArgs = z.object({
  nodeId: z.string(),
  scale: z.number().min(0.5).max(3).optional(),
});

// ---------- tool definitions ----------
const tools = [
  {
    name: "get_basic_info",
    description:
      "Returns project name, detected framework, design-system summary, and the list of artboards on the canvas. Call this first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_design_system",
    description:
      "Returns the indexed design system for the project (Tailwind config path, CSS custom properties, available components). Use to pick correct tokens and components when composing UI.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_artboard",
    description:
      "Create a new top-level artboard (frame) on the canvas. Returns its id which you pass to write_html.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        styles: { type: "object", description: "CSS styles (camelCased)" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "write_html",
    description:
      "Insert or replace HTML at a target node. Use inline `style` attributes; they parse into the canvas style model.",
    inputSchema: {
      type: "object",
      required: ["targetNodeId", "mode", "html"],
      properties: {
        targetNodeId: { type: "string" },
        mode: { enum: ["insert-children", "replace"] },
        html: { type: "string" },
      },
    },
  },
  {
    name: "update_styles",
    description: "Patch styles on one or more nodes. Existing styles are merged.",
    inputSchema: {
      type: "object",
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            required: ["nodeIds", "styles"],
            properties: {
              nodeIds: { type: "array", items: { type: "string" } },
              styles: { type: "object" },
            },
          },
        },
      },
    },
  },
  {
    name: "get_jsx",
    description:
      "Return JSX for a node and its descendants. Use this when translating the canvas to React. Output uses inline style objects; you may rewrite to className later.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: { nodeId: { type: "string" } },
    },
  },
  {
    name: "get_node_info",
    description:
      "Returns a node's tag, layer name, styles, and child summary. Useful for inspection without dumping the whole tree.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: { nodeId: { type: "string" } },
    },
  },
  {
    name: "get_computed_styles",
    description:
      "Resolved CSS values for a node from the live canvas (window.getComputedStyle). Use this to translate to Tailwind classes or matched design tokens. Requires the canvas to be open.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: { type: "string" },
        properties: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of CSS property names to fetch. Defaults to a curated set.",
        },
      },
    },
  },
  {
    name: "get_screenshot",
    description:
      "PNG screenshot of a node from the live canvas. Returns a base64 data URL plus dimensions. Use for vision-grounded translation when computed styles aren't enough. Requires the canvas to be open.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: { type: "string" },
        scale: {
          type: "number",
          description: "Pixel ratio (0.5–3). Default 1.",
        },
      },
    },
  },
  {
    name: "delete_node",
    description:
      "Remove a node (or whole artboard) from the canvas. Use to clean up exploration before translating to code.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: { nodeId: { type: "string" } },
    },
  },
  {
    name: "reset_canvas",
    description:
      "Clear all artboards. Useful when starting a fresh translation pass; the autosave file is overwritten.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_selection",
    description:
      "Returns the node currently selected on the canvas (the user's focus), or null if nothing is selected. Use this to know what the user is asking you to act on without them having to paste an id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_selection",
    description:
      "Highlight a node on the canvas — moves the user's selection so they see what you're about to change. Pass null to clear.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: {
          type: ["string", "null"],
          description: "The node id to select, or null to clear.",
        },
      },
    },
  },
  {
    name: "set_text",
    description:
      "Replace a text-leaf node's text. Cheaper than write_html when you only need to change the words. Use for typo fixes, copy edits, microcopy iteration.",
    inputSchema: {
      type: "object",
      required: ["nodeId", "text"],
      properties: {
        nodeId: { type: "string" },
        text: { type: "string" },
      },
    },
  },
  {
    name: "set_layer_name",
    description:
      "Rename a node's layer-tree label (typically used for artboards: 'Hero / Desktop' → 'Pricing / Desktop'). Doesn't affect rendering, only the tree.",
    inputSchema: {
      type: "object",
      required: ["nodeId", "layerName"],
      properties: {
        nodeId: { type: "string" },
        layerName: { type: "string" },
      },
    },
  },
  {
    name: "set_document_name",
    description:
      "Rename the document (the file label in the topbar). Persists in the autosave file.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    },
  },
  {
    name: "duplicate_artboard",
    description:
      "Deep-clone an artboard (whole tree, fresh ids) and place it next to the existing artboards. Returns the new artboard's id.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: { type: "string" },
      },
    },
  },
];

// ---------- MCP server ----------
async function main() {
  await refreshDS();
  const loaded = await loadIfExists();
  if (!loaded && canvas.getArtboards().length === 0) {
    canvas.setArtboards(SEED_ARTBOARDS);
  }
  startAutosave();
  startBridge();

  const server = new Server(
    { name: "easel-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const content = await dispatch(name, args ?? {});
      return { content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type Content = TextContent | ImageContent;

const text = (value: unknown): Content[] => [
  {
    type: "text",
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  },
];

async function dispatch(
  name: string,
  args: Record<string, unknown>,
): Promise<Content[]> {
  switch (name) {
    case "get_basic_info":
      return text(buildBasicInfo());

    case "get_design_system":
      if (!designSystem) await refreshDS();
      return text(designSystem);

    case "create_artboard": {
      const a = CreateArtboardArgs.parse(args);
      const id = canvas.nextId("ab");
      const x = a.x ?? nextArtboardX();
      const y = a.y ?? 80;
      const ab: Artboard = {
        id,
        tag: "artboard",
        layerName: a.name,
        x,
        y,
        styles: { width: "1200px", height: "720px", padding: "48px", ...a.styles },
        children: [],
      };
      canvas.upsertArtboard(ab);
      return text({ id, name: a.name, x, y });
    }

    case "write_html": {
      const a = WriteHtmlArgs.parse(args);
      const target = canvas.findNode(a.targetNodeId);
      if (!target) throw new Error(`Node not found: ${a.targetNodeId}`);
      const parsed = parseHtmlFragment(a.html);
      if (a.mode === "insert-children") {
        canvas.appendChildren(a.targetNodeId, parsed);
      } else {
        if (parsed.length !== 1) {
          throw new Error("Replace mode requires exactly one root element");
        }
        canvas.replaceNode(a.targetNodeId, parsed[0]!);
      }
      return text({ ok: true, inserted: parsed.map((p) => p.id) });
    }

    case "update_styles": {
      const a = UpdateStylesArgs.parse(args);
      const updated: string[] = [];
      const missing: string[] = [];
      for (const u of a.updates) {
        for (const id of u.nodeIds) {
          if (canvas.updateStyles(id, u.styles)) updated.push(id);
          else missing.push(id);
        }
      }
      return text({ updated, missing });
    }

    case "get_jsx": {
      const a = GetJsxArgs.parse(args);
      const node = canvas.findNode(a.nodeId);
      if (!node) throw new Error(`Node not found: ${a.nodeId}`);
      return text(emitJsx(node));
    }

    case "get_node_info": {
      const a = GetNodeInfoArgs.parse(args);
      const node = canvas.findNode(a.nodeId);
      if (!node) throw new Error(`Node not found: ${a.nodeId}`);
      return text({
        id: node.id,
        tag: node.tag,
        layerName: node.layerName,
        styles: node.styles ?? {},
        text: node.text,
        childCount: node.children?.length ?? 0,
      });
    }

    case "get_computed_styles": {
      const a = GetComputedStylesArgs.parse(args);
      if (!canvas.findNode(a.nodeId)) {
        throw new Error(`Node not found in tree: ${a.nodeId}`);
      }
      const styles = await rpc.call<Record<string, string>>(
        "get_computed_styles",
        { nodeId: a.nodeId, properties: a.properties },
        5000,
      );
      return text(styles);
    }

    case "get_screenshot": {
      const a = GetScreenshotArgs.parse(args);
      if (!canvas.findNode(a.nodeId)) {
        throw new Error(`Node not found in tree: ${a.nodeId}`);
      }
      const shot = await rpc.call<{
        mimeType: string;
        data: string;
        width: number;
        height: number;
      }>("get_screenshot", { nodeId: a.nodeId, scale: a.scale ?? 1 }, 15000);
      return [
        { type: "image", data: shot.data, mimeType: shot.mimeType },
        {
          type: "text",
          text: `Screenshot of ${a.nodeId} (${shot.width}×${shot.height}px)`,
        },
      ];
    }

    case "delete_node": {
      const a = DeleteNodeArgs.parse(args);
      const ok = canvas.deleteNode(a.nodeId);
      if (!ok) throw new Error(`Node not found: ${a.nodeId}`);
      return text({ deleted: a.nodeId });
    }

    case "reset_canvas": {
      canvas.setArtboards([]);
      return text({ ok: true });
    }

    case "get_selection": {
      const id = canvas.getSelectedId();
      if (!id) return text({ id: null });
      const node = canvas.findNode(id);
      if (!node) return text({ id, found: false });
      return text({
        id,
        tag: node.tag,
        layerName: node.layerName,
        styles: node.styles ?? {},
        text: node.text,
        childCount: node.children?.length ?? 0,
      });
    }

    case "set_selection": {
      const a = SetSelectionArgs.parse(args);
      if (a.nodeId !== null && !canvas.findNode(a.nodeId)) {
        throw new Error(`Node not found: ${a.nodeId}`);
      }
      canvas.setSelection(a.nodeId);
      return text({ selected: a.nodeId });
    }

    case "set_text": {
      const a = SetTextArgs.parse(args);
      const ok = canvas.setText(a.nodeId, a.text);
      if (!ok) throw new Error(`Node not found: ${a.nodeId}`);
      return text({ ok: true, nodeId: a.nodeId });
    }

    case "set_layer_name": {
      const a = SetLayerNameArgs.parse(args);
      const ok = canvas.setLayerName(a.nodeId, a.layerName);
      if (!ok) throw new Error(`Node not found: ${a.nodeId}`);
      return text({ ok: true, nodeId: a.nodeId, layerName: a.layerName });
    }

    case "set_document_name": {
      const a = SetDocumentNameArgs.parse(args);
      canvas.setDocumentName(a.name);
      return text({ documentName: canvas.getDocumentName() });
    }

    case "duplicate_artboard": {
      const a = DuplicateArtboardArgs.parse(args);
      const ab = canvas.duplicateArtboard(a.nodeId);
      if (!ab) throw new Error(`Artboard not found: ${a.nodeId}`);
      // Auto-select so the user (and the agent's next get_selection) sees it.
      canvas.setSelection(ab.id);
      return text({
        id: ab.id,
        layerName: ab.layerName,
        x: ab.x,
        y: ab.y,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function buildBasicInfo() {
  const artboards = canvas.getArtboards();
  return {
    canvas: {
      artboardCount: artboards.length,
      artboards: artboards.map((a: Artboard) => ({
        id: a.id,
        name: a.layerName,
        size: { width: a.styles?.width, height: a.styles?.height },
      })),
    },
    project: designSystem
      ? {
          name: designSystem.packageJson.name,
          framework: designSystem.framework,
          tailwindConfig: designSystem.styling.tailwindConfigPath,
          componentCount: designSystem.components.length,
        }
      : null,
  };
}

function nextArtboardX(): number {
  const existing = canvas.getArtboards();
  if (existing.length === 0) return 80;
  const last = existing[existing.length - 1]!;
  const widthVal = last.styles?.width;
  const width = typeof widthVal === "string" ? parseInt(widthVal, 10) : 1200;
  return last.x + (Number.isFinite(width) ? width : 1200) + 80;
}

// Suppress noisy unused warnings when the parser util isn't called from this module.
void parseStyle;
void ((p: PaperNode) => p);

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[easel-mcp] fatal:", err);
  process.exit(1);
});
