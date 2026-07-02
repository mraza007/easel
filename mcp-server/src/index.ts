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
import { diffTrees } from "./diff.js";
import { bundleComponent } from "./component-bundler.js";
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
const GetTreeArgs = z.object({
  nodeId: z.string().optional(),
  depth: z.number().int().min(1).max(10).default(3),
});
const GetNodeInfoArgs = z.object({ nodeId: z.string() });
const DeleteNodeArgs = z.object({ nodeId: z.string() });
const SetSelectionArgs = z.object({ nodeId: z.string().nullable() });
const SetTextArgs = z.object({ nodeId: z.string(), text: z.string() });
const SetLayerNameArgs = z.object({ nodeId: z.string(), layerName: z.string() });
const SetDocumentNameArgs = z.object({ name: z.string() });
const DuplicateArtboardArgs = z.object({ nodeId: z.string() });
const ApplyTokenArgs = z.object({
  nodeIds: z.array(z.string()).min(1),
  property: z.string().describe("camelCased CSS property, e.g. backgroundColor"),
  token: z.string().describe("custom-property name without the leading --"),
});
const MoveArtboardArgs = z.object({
  nodeId: z.string(),
  x: z.number(),
  y: z.number(),
});
const DiffArtboardsArgs = z.object({ nodeIdA: z.string(), nodeIdB: z.string() });
const CreateVariantArgs = z.object({
  nodeId: z.string(),
  width: z.number().int().min(120).max(3840),
  breakpoint: z.string().optional(),
});
const GetVariantsArgs = z.object({ nodeId: z.string() });
const AddCommentArgs = z.object({
  nodeId: z.string(),
  text: z.string().min(1),
});
const GetCommentsArgs = z.object({
  nodeId: z.string().optional(),
  includeResolved: z.boolean().default(false),
});
const ResolveCommentArgs = z.object({ id: z.string() });
const InsertComponentArgs = z.object({
  targetNodeId: z.string(),
  component: z.string(),
  props: z.record(z.unknown()).default({}),
  width: z.number().optional(),
  height: z.number().optional(),
});
const DesignToCodeArgs = z.object({
  nodeId: z.string(),
  framework: z.enum(["react", "vue", "svelte"]).optional(),
});

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
    name: "get_tree",
    description:
      "Compact indented outline of the canvas tree (id, tag, layer name, text preview) — one line per node. Far cheaper than get_jsx for orientation; use it to find node ids before targeted reads or writes. Omit nodeId for all artboards.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Subtree root. Defaults to the whole canvas." },
        depth: { type: "number", description: "Max depth (1-10). Default 3." },
      },
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
  {
    name: "apply_token",
    description:
      "Set a style property to a design-system token: styles[property] = var(--token). Validates the token against the scanned design system, so prefer this over update_styles with raw values when a token matches the intent.",
    inputSchema: {
      type: "object",
      required: ["nodeIds", "property", "token"],
      properties: {
        nodeIds: { type: "array", items: { type: "string" } },
        property: { type: "string", description: "camelCased CSS property" },
        token: {
          type: "string",
          description: "Token name without the leading --. See get_design_system.",
        },
      },
    },
  },
  {
    name: "move_artboard",
    description: "Reposition a top-level artboard on the canvas (world coordinates).",
    inputSchema: {
      type: "object",
      required: ["nodeId", "x", "y"],
      properties: {
        nodeId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "undo",
    description:
      "Undo the last canvas mutation (yours or the user's). Returns remaining history depth.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "redo",
    description: "Redo the most recently undone canvas mutation.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "diff_artboards",
    description:
      "Structured diff between two subtrees (usually artboards): added/removed nodes and per-node style/text/tag changes. Use to compare design iterations or check variant drift.",
    inputSchema: {
      type: "object",
      required: ["nodeIdA", "nodeIdB"],
      properties: {
        nodeIdA: { type: "string", description: "Baseline subtree" },
        nodeIdB: { type: "string", description: "Comparison subtree" },
      },
    },
  },
  {
    name: "create_variant",
    description:
      "Clone an artboard as a linked responsive variant at a given width (e.g. 375 for mobile). The clone keeps content but you should then adapt its layout. Variants stay linked via variantOf for get_variants/diff_artboards.",
    inputSchema: {
      type: "object",
      required: ["nodeId", "width"],
      properties: {
        nodeId: { type: "string" },
        width: { type: "number", description: "Variant width in px" },
        breakpoint: { type: "string", description: "Label, e.g. 'mobile'. Defaults to the width." },
      },
    },
  },
  {
    name: "get_variants",
    description: "List the variant group an artboard belongs to (base + all linked variants).",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: { nodeId: { type: "string" } },
    },
  },
  {
    name: "add_comment",
    description:
      "Pin a comment to a node on the canvas — use to explain non-obvious choices ('matched your text-sm token here') or ask the user a question. Users see pins and can reply; poll get_comments for replies.",
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
    name: "get_comments",
    description:
      "List canvas comments (agent + user), newest last. Filter by nodeId; resolved comments are hidden unless includeResolved.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        includeResolved: { type: "boolean" },
      },
    },
  },
  {
    name: "resolve_comment",
    description: "Mark a comment as resolved (e.g. after addressing the user's feedback).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "insert_component",
    description:
      "Insert one of the project's REAL components (from get_design_system) onto the canvas. The canvas bundles the actual source with the project's own react and renders it in a sandboxed iframe — what you see is the real component. Props must be JSON-serializable. Note: CSS imports are stubbed; Tailwind-styled components render unstyled in v1.",
    inputSchema: {
      type: "object",
      required: ["targetNodeId", "component"],
      properties: {
        targetNodeId: { type: "string" },
        component: { type: "string", description: "Component name from get_design_system" },
        props: { type: "object", description: "JSON-serializable props" },
        width: { type: "number", description: "Frame width px (default 320)" },
        height: { type: "number", description: "Frame height px (default 120)" },
      },
    },
  },
  {
    name: "design_to_code",
    description:
      "Translate a design subtree to production code. Returns a screenshot, the design's JSX, root computed styles, the project's design-system summary, and a translation brief. Use this INSTEAD of stitching together get_jsx + get_computed_styles + get_screenshot + get_design_system. After receiving it, write the resulting component to the user's repo using your own file-editing tools — do not return code in chat.",
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: {
          type: "string",
          description: "The artboard or subtree to translate. Usually an artboard id from get_basic_info.",
        },
        framework: {
          type: "string",
          enum: ["react", "vue", "svelte"],
          description: "Target framework. Defaults to whatever ds-scanner detected from the project's package.json.",
        },
      },
    },
  },
];

// ---------- MCP server ----------
async function main() {
  await refreshDS();
  const loaded = await loadIfExists();
  if (!loaded && canvas.getArtboards().length === 0) {
    canvas.setArtboards(SEED_ARTBOARDS, { clearHistory: true });
  }
  startAutosave();
  await startBridge({
    getDesignSystem: () => dsSummaryForCanvas(),
    bundleComponent: async (name, props) => {
      if (!designSystem) await refreshDS();
      const entry = designSystem?.components.find((c) => c.name === name);
      if (!entry) return { ok: false, error: `unknown component: ${name}` };
      return bundleComponent(PROJECT_ROOT, entry, props);
    },
  });

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
    // Compact JSON: tool results go straight into the agent's context, and
    // pretty-printing roughly doubles the token cost of large trees.
    text: typeof value === "string" ? value : JSON.stringify(value),
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
        const r = canvas.updateStylesMany(u.nodeIds, u.styles);
        updated.push(...r.updated);
        missing.push(...r.missing);
      }
      return text({ updated, missing });
    }

    case "apply_token": {
      const a = ApplyTokenArgs.parse(args);
      if (!designSystem) await refreshDS();
      const name = a.token.replace(/^--/, "");
      const known = designSystem?.styling.customProperties ?? {};
      if (!(name in known)) {
        const sample = Object.keys(known).slice(0, 20).join(", ") || "(none scanned)";
        throw new Error(`Unknown token "${name}". Known tokens include: ${sample}`);
      }
      const r = canvas.updateStylesMany(a.nodeIds, {
        [a.property]: `var(--${name})`,
      });
      return text({ ...r, applied: `var(--${name})`, value: known[name] });
    }

    case "move_artboard": {
      const a = MoveArtboardArgs.parse(args);
      if (!canvas.moveArtboard(a.nodeId, a.x, a.y)) {
        throw new Error(`Artboard not found: ${a.nodeId}`);
      }
      return text({ ok: true, nodeId: a.nodeId, x: a.x, y: a.y });
    }

    case "undo": {
      const ok = canvas.undo();
      return text({ ok, ...canvas.historyDepth() });
    }

    case "redo": {
      const ok = canvas.redo();
      return text({ ok, ...canvas.historyDepth() });
    }

    case "get_jsx": {
      const a = GetJsxArgs.parse(args);
      const node = canvas.findNode(a.nodeId);
      if (!node) throw new Error(`Node not found: ${a.nodeId}`);
      return text(emitJsx(node));
    }

    case "get_tree": {
      const a = GetTreeArgs.parse(args);
      let roots: PaperNode[];
      if (a.nodeId) {
        const node = canvas.findNode(a.nodeId);
        if (!node) throw new Error(`Node not found: ${a.nodeId}`);
        roots = [node];
      } else {
        roots = canvas.getArtboards();
      }
      const lines = roots.flatMap((r) => outlineNode(r, 0, a.depth));
      return text(lines.join("\n") || "(canvas is empty)");
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

    case "diff_artboards": {
      const a = DiffArtboardsArgs.parse(args);
      const nodeA = canvas.findNode(a.nodeIdA);
      const nodeB = canvas.findNode(a.nodeIdB);
      if (!nodeA) throw new Error(`Node not found: ${a.nodeIdA}`);
      if (!nodeB) throw new Error(`Node not found: ${a.nodeIdB}`);
      const diffs = diffTrees(nodeA, nodeB);
      return text({ changes: diffs.length, diffs });
    }

    case "create_variant": {
      const a = CreateVariantArgs.parse(args);
      const base = canvas.getArtboards().find((ab) => ab.id === a.nodeId);
      if (!base) throw new Error(`Artboard not found: ${a.nodeId}`);
      const clone = canvas.duplicateArtboard(a.nodeId);
      if (!clone) throw new Error(`Artboard not found: ${a.nodeId}`);
      const breakpoint = a.breakpoint ?? String(a.width);
      // Root of a variant group is the base itself (follow existing links).
      const rootId = base.variantOf ?? base.id;
      const updated: Artboard = {
        ...clone,
        variantOf: rootId,
        breakpoint,
        layerName: `${(base.layerName ?? "Artboard").split(" / ")[0]} / ${breakpoint}`,
        styles: { ...(clone.styles ?? {}), width: `${a.width}px` },
      };
      canvas.upsertArtboard(updated);
      canvas.setSelection(updated.id);
      return text({
        id: updated.id,
        layerName: updated.layerName,
        breakpoint,
        variantOf: rootId,
        note: "Content was cloned as-is; adapt the layout for this width, then diff_artboards against the base to review.",
      });
    }

    case "get_variants": {
      const a = GetVariantsArgs.parse(args);
      const all = canvas.getArtboards();
      const target = all.find((ab) => ab.id === a.nodeId);
      if (!target) throw new Error(`Artboard not found: ${a.nodeId}`);
      const rootId = target.variantOf ?? target.id;
      const group = all.filter((ab) => ab.id === rootId || ab.variantOf === rootId);
      return text({
        base: rootId,
        variants: group.map((ab) => ({
          id: ab.id,
          layerName: ab.layerName,
          breakpoint: ab.breakpoint ?? (ab.id === rootId ? "base" : undefined),
          width: ab.styles?.width,
        })),
      });
    }

    case "add_comment": {
      const a = AddCommentArgs.parse(args);
      if (!canvas.findNode(a.nodeId)) throw new Error(`Node not found: ${a.nodeId}`);
      const comment = canvas.addComment({
        nodeId: a.nodeId,
        author: "agent",
        text: a.text,
      });
      return text({ ok: true, id: comment.id });
    }

    case "get_comments": {
      const a = GetCommentsArgs.parse(args);
      const comments = canvas
        .getComments(a.nodeId)
        .filter((c) => a.includeResolved || !c.resolved);
      return text({ count: comments.length, comments });
    }

    case "resolve_comment": {
      const a = ResolveCommentArgs.parse(args);
      if (!canvas.resolveComment(a.id)) throw new Error(`Comment not found: ${a.id}`);
      return text({ ok: true });
    }

    case "insert_component": {
      const a = InsertComponentArgs.parse(args);
      if (!canvas.findNode(a.targetNodeId)) {
        throw new Error(`Node not found: ${a.targetNodeId}`);
      }
      if (!designSystem) await refreshDS();
      const entry = designSystem?.components.find((c) => c.name === a.component);
      if (!entry) {
        const known = (designSystem?.components ?? []).slice(0, 20).map((c) => c.name);
        throw new Error(
          `Unknown component "${a.component}". Known: ${known.join(", ") || "(none)"}`,
        );
      }
      const node: PaperNode = {
        id: canvas.nextId("cmp"),
        tag: "component",
        layerName: a.component,
        styles: {
          width: `${a.width ?? 320}px`,
          height: `${a.height ?? 120}px`,
          display: "inline-block",
        },
        attrs: {
          component: a.component,
          props: JSON.stringify(a.props),
        },
      };
      canvas.appendChildren(a.targetNodeId, [node]);
      return text({
        ok: true,
        id: node.id,
        note: "Rendered in a sandbox iframe from the project's real source. CSS imports are stubbed in v1 — Tailwind-styled components appear unstyled.",
      });
    }

    case "design_to_code": {
      const a = DesignToCodeArgs.parse(args);
      const node = canvas.findNode(a.nodeId);
      if (!node) throw new Error(`Node not found: ${a.nodeId}`);
      if (!designSystem) await refreshDS();

      const jsx = emitJsx(node);
      const detected = designSystem?.framework;
      const framework =
        a.framework ?? (detected && detected !== "unknown" ? detected : "react");

      let computedStyles: Record<string, string> | null = null;
      try {
        computedStyles = await rpc.call<Record<string, string>>(
          "get_computed_styles",
          { nodeId: a.nodeId },
          5000,
        );
      } catch {
        // Canvas may be disconnected; fall back to authored styles only.
      }

      let shot: { mimeType: string; data: string; width: number; height: number } | null =
        null;
      try {
        shot = await rpc.call(
          "get_screenshot",
          { nodeId: a.nodeId, scale: 1 },
          15000,
        );
      } catch {
        // No canvas — proceed without visual reference.
      }

      const dsSummary = designSystem
        ? {
            framework: designSystem.framework,
            tailwindConfigPath: designSystem.styling.tailwindConfigPath,
            cssEntryPaths: designSystem.styling.cssEntryPaths,
            customProperties: designSystem.styling.customProperties,
            componentCount: designSystem.components.length,
            components: designSystem.components.slice(0, 30).map((c) => ({
              name: c.name,
              file: c.filePath,
              exportType: c.exportType,
            })),
          }
        : null;

      const brief = buildDesignBrief({
        nodeId: a.nodeId,
        layerName: node.layerName,
        framework,
        jsx,
        computedStyles,
        designSystem: dsSummary,
        hasScreenshot: shot !== null,
      });

      const content: Content[] = [];
      if (shot) {
        content.push({ type: "image", data: shot.data, mimeType: shot.mimeType });
      }
      content.push({ type: "text", text: brief });
      return content;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface BriefInput {
  nodeId: string;
  layerName: string | undefined;
  framework: string;
  jsx: string;
  computedStyles: Record<string, string> | null;
  designSystem: unknown;
  hasScreenshot: boolean;
}

function buildDesignBrief(b: BriefInput): string {
  const lines: string[] = [];
  lines.push(`# Design → ${b.framework} translation`);
  lines.push("");
  lines.push(
    `Translating **${b.layerName ?? b.nodeId}** to production code in the user's repo.`,
  );
  lines.push("");
  lines.push("## How to translate");
  lines.push("");
  lines.push(
    "1. **Match conventions.** Read the project's existing components and adopt the same style (Tailwind classes vs inline, CSS modules vs CSS-in-JS, named vs default exports, file naming). Don't introduce a new pattern.",
  );
  lines.push(
    "2. **Use the design system.** Where the design has a hex color, font size, or spacing value, look for a matching token in the design-system summary below and prefer the token. If the design has a button that looks like the project's existing `<Button>`, use it — don't reimplement.",
  );
  lines.push(
    "3. **Pick component boundaries thoughtfully.** Don't translate as a single monolithic block. Break out cards, sections, and repeated patterns into reusable child components.",
  );
  lines.push(
    "4. **Match intent, not pixels.** If the design uses `14px` and the project uses Tailwind's `text-sm`, use the class. Round to nearest token where reasonable.",
  );
  lines.push(
    "5. **Write the code.** Use your file-editing tools to create the file(s) in the user's project. Do NOT return code in chat — write it to disk.",
  );
  lines.push(
    "6. **Tell the user where you put it.** After writing, briefly summarize the files you created and any follow-up they should run (e.g., `pnpm install` if you added a dep).",
  );
  lines.push("");
  if (b.hasScreenshot) {
    lines.push(
      "The screenshot above shows what the user sees on the canvas. Refer to it for spatial intent, alignment, and visual hierarchy that JSX alone might not convey.",
    );
    lines.push("");
  }
  lines.push("## Design tree");
  lines.push("");
  lines.push("```jsx");
  lines.push(b.jsx);
  lines.push("```");
  lines.push("");
  lines.push("## Computed styles (root node)");
  lines.push("");
  if (b.computedStyles) {
    lines.push("```json");
    lines.push(JSON.stringify(b.computedStyles, null, 2));
    lines.push("```");
    lines.push("");
    lines.push(
      "For descendants, call `get_computed_styles` per-node — the design tree above lists every `data-easel-id` you can pass.",
    );
  } else {
    lines.push(
      "_(canvas not connected — call `get_computed_styles` once it is, or rely on authored styles in the JSX above)_",
    );
  }
  lines.push("");
  lines.push("## Design system");
  lines.push("");
  if (b.designSystem) {
    lines.push("```json");
    lines.push(JSON.stringify(b.designSystem, null, 2));
    lines.push("```");
    lines.push("");
    lines.push(
      "Read the listed component files before generating to confirm props, variants, and import paths.",
    );
  } else {
    lines.push(
      "_(no design system detected — generate plain HTML/CSS or inline styles and let the user wire to their tokens)_",
    );
  }
  return lines.join("\n");
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

/**
 * One line per node: `id <tag> "layer name" — text preview`. Children beyond
 * maxDepth collapse to a count so large trees stay cheap to read.
 */
function outlineNode(node: PaperNode, depth: number, maxDepth: number): string[] {
  const pad = "  ".repeat(depth);
  const parts = [`${pad}${node.id} <${node.tag}>`];
  if (node.layerName) parts.push(`"${node.layerName}"`);
  if (node.text) {
    const t = node.text.length > 40 ? `${node.text.slice(0, 40)}…` : node.text;
    parts.push(`— ${t}`);
  }
  const lines = [parts.join(" ")];
  const kids = node.children ?? [];
  if (kids.length === 0) return lines;
  if (depth + 1 >= maxDepth) {
    lines.push(`${pad}  … ${kids.length} more (raise depth or pass nodeId)`);
    return lines;
  }
  for (const c of kids) lines.push(...outlineNode(c, depth + 1, maxDepth));
  return lines;
}

/** Slim design-system payload for the canvas (tokens panel + :root injection). */
function dsSummaryForCanvas() {
  if (!designSystem) return null;
  return {
    framework: designSystem.framework,
    customProperties: designSystem.styling.customProperties,
    components: designSystem.components.map((c) => ({
      name: c.name,
      filePath: c.filePath,
      ...(c.props ? { props: c.props } : {}),
      ...(c.variants ? { variants: c.variants } : {}),
    })),
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
