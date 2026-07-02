import { WebSocketServer, type WebSocket } from "ws";
import { canvas } from "./state.js";
import { rpc, type RpcInbound, type RpcRequest } from "./rpc.js";
import { getServerInfo } from "./server-info.js";
import { reloadFromDisk } from "./persistence.js";
import { parseHtmlFragment } from "./html-parser.js";

// First port in the fallback range. Each IDE agent spawns its own MCP server,
// so 7777 may already be taken by another agent's bridge — walk forward until
// a port binds. The canvas probes the same range from its side.
const WS_PORT_START = 7777;
const WS_PORT_RANGE = 10;

interface SelectionInbound {
  type: "selection";
  id: string | null;
}

/**
 * Mutations originated by the canvas (keyboard shortcuts, style inspector).
 * The op vocabulary mirrors the MCP write tools. We let the canvas do the
 * same things the agent can do, just over WS instead of stdio.
 */
interface MutationInbound {
  type: "mutation";
  op:
    | "delete-node"
    | "update-styles"
    | "set-text"
    | "set-layer-name"
    | "set-document-name"
    | "create-artboard"
    | "duplicate-artboard"
    | "move-artboard"
    | "insert-html"
    | "reorder-node"
    | "add-comment"
    | "resolve-comment"
    | "delete-comment"
    | "undo"
    | "redo"
    | "reload-state"
    | "reset-canvas";
  payload: unknown;
}

/** Canvas asks for a component bundle to render inside a sandbox iframe. */
interface BundleRequestInbound {
  type: "get-bundle";
  id: string;
  component: string;
  props?: Record<string, unknown>;
}

type Inbound = RpcInbound | SelectionInbound | MutationInbound | BundleRequestInbound;

/**
 * Local WebSocket bridge.
 *
 * Outbound: state snapshots (full tree), set-selection (selection sync from
 * agent to canvas), and RPC requests for things only the live DOM knows.
 * Inbound: RPC results, selection updates from the canvas.
 *
 * Bound to 127.0.0.1 — never exposed to the network. Browser clients must
 * present a localhost Origin: without the check, any webpage the user visits
 * could open ws://127.0.0.1 and read or mutate canvas state.
 */
export interface BridgeOptions {
  /** Design-system summary pushed to each canvas on connect (tokens panel + var() rendering). */
  getDesignSystem?: () => unknown;
  /** Bundle a project component for sandbox rendering; null if unknown. */
  bundleComponent?: (
    name: string,
    props: Record<string, unknown>,
  ) => Promise<{ ok: boolean; js?: string; error?: string }>;
}

export async function startBridge(options: BridgeOptions = {}) {
  const wss = await listenOnFreePort();
  const clients = new Set<WebSocket>();

  // Wire the module-level broadcastInfo to this bridge's clients set so that
  // handleMutation (a free function) can trigger a broadcast after reload-state.
  broadcastInfo = async () => {
    const info = await getServerInfo();
    for (const ws of clients) send(ws, { type: "server-info", payload: info });
  };

  const refreshSender = () => {
    const active = pickActive(clients);
    if (!active) {
      rpc.setSender(null);
      return;
    }
    rpc.setSender((msg: RpcRequest) => {
      if (active.readyState !== active.OPEN) return false;
      active.send(JSON.stringify(msg));
      return true;
    });
  };

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    refreshSender();

    const unsubscribeState = canvas.subscribe((state) => {
      send(ws, { type: "state", payload: state });
    });
    const unsubscribeSelection = canvas.subscribeSelection((id) => {
      send(ws, { type: "set-selection", id });
    });
    const unsubscribeMetadata = canvas.subscribeMetadata((meta) => {
      send(ws, { type: "metadata", payload: meta });
    });
    const unsubscribeComments = canvas.subscribeComments((comments) => {
      send(ws, { type: "comments", payload: comments });
    });

    // Send server info on connect — popover renders from this snapshot.
    void getServerInfo().then((info) =>
      send(ws, { type: "server-info", payload: info }),
    );

    // Design system: the canvas injects custom properties into :root so
    // var(--token) styles resolve, and renders the tokens panel from it.
    const ds = options.getDesignSystem?.();
    if (ds) send(ws, { type: "design-system", payload: ds });

    ws.on("message", (raw: Buffer | string) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }
      if (!isInbound(data)) return;
      if (data.type === "selection") {
        canvas.setSelection(data.id);
        return;
      }
      if (data.type === "mutation") {
        handleMutation(data);
        return;
      }
      if (data.type === "get-bundle") {
        const req = data;
        const run = options.bundleComponent;
        if (!run) {
          send(ws, { type: "bundle", id: req.id, ok: false, error: "bundling unavailable" });
          return;
        }
        void run(req.component, req.props ?? {}).then((result) =>
          send(ws, { type: "bundle", id: req.id, ...result }),
        );
        return;
      }
      rpc.handleInbound(data);
    });

    ws.on("close", () => {
      clients.delete(ws);
      unsubscribeState();
      unsubscribeSelection();
      unsubscribeMetadata();
      unsubscribeComments();
      refreshSender();
    });

    ws.on("error", () => {
      try {
        unsubscribeState();
        unsubscribeSelection();
        unsubscribeMetadata();
        unsubscribeComments();
      } catch {
        // already disposed
      }
    });
  });

  wss.on("error", (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[easel] ws server error:", err);
  });

  return { close: () => wss.close() };
}

function isAllowedOrigin(origin: string | undefined): boolean {
  // Browsers always send Origin, so a missing header can't be a cross-origin
  // page — only non-browser localhost clients omit it.
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function listenOnFreePort(): Promise<WebSocketServer> {
  let lastErr: unknown;
  for (let port = WS_PORT_START; port < WS_PORT_START + WS_PORT_RANGE; port++) {
    try {
      return await new Promise<WebSocketServer>((resolve, reject) => {
        const wss = new WebSocketServer({
          host: "127.0.0.1",
          port,
          verifyClient: (info: { origin?: string }) => isAllowedOrigin(info.origin),
        });
        wss.once("listening", () => {
          if (port !== WS_PORT_START) {
            // eslint-disable-next-line no-console
            console.error(`[easel] port ${WS_PORT_START} busy; ws bridge on ${port}`);
          }
          resolve(wss);
        });
        wss.once("error", reject);
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      lastErr = err;
    }
  }
  throw new Error(
    `no free ws port in ${WS_PORT_START}-${WS_PORT_START + WS_PORT_RANGE - 1}`,
    { cause: lastErr },
  );
}

function pickActive(clients: Set<WebSocket>): WebSocket | null {
  for (const c of clients) {
    if (c.readyState === c.OPEN) return c;
  }
  return null;
}

function isInbound(value: unknown): value is Inbound {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === "rpc-result" ||
    t === "rpc-error" ||
    t === "selection" ||
    t === "mutation" ||
    t === "get-bundle"
  );
}

function handleMutation(msg: MutationInbound): void {
  switch (msg.op) {
    case "delete-node": {
      const payload = msg.payload as { nodeId?: unknown } | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      const ok = canvas.deleteNode(payload.nodeId);
      if (ok && canvas.getSelectedId() === payload.nodeId) {
        canvas.setSelection(null);
      }
      return;
    }
    case "update-styles": {
      const payload = msg.payload as
        | { nodeId?: unknown; nodeIds?: unknown; styles?: unknown }
        | null;
      if (!payload || !payload.styles || typeof payload.styles !== "object") return;
      const ids = Array.isArray(payload.nodeIds)
        ? payload.nodeIds.filter((id): id is string => typeof id === "string")
        : typeof payload.nodeId === "string"
          ? [payload.nodeId]
          : [];
      canvas.updateStylesMany(ids, payload.styles as Record<string, string | number>);
      return;
    }
    case "move-artboard": {
      const payload = msg.payload as
        | { nodeId?: unknown; x?: unknown; y?: unknown }
        | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (typeof payload.x !== "number" || typeof payload.y !== "number") return;
      canvas.moveArtboard(payload.nodeId, payload.x, payload.y);
      return;
    }
    case "insert-html": {
      // Canvas-side insert palette. Same sanitizer path as the write_html tool.
      const payload = msg.payload as
        | { targetNodeId?: unknown; html?: unknown }
        | null;
      if (!payload || typeof payload.targetNodeId !== "string") return;
      if (typeof payload.html !== "string") return;
      if (!canvas.findNode(payload.targetNodeId)) return;
      const parsed = parseHtmlFragment(payload.html);
      if (parsed.length > 0) canvas.appendChildren(payload.targetNodeId, parsed);
      return;
    }
    case "reorder-node": {
      const payload = msg.payload as
        | { nodeId?: unknown; direction?: unknown }
        | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (payload.direction !== -1 && payload.direction !== 1) return;
      canvas.reorderNode(payload.nodeId, payload.direction);
      return;
    }
    case "add-comment": {
      const payload = msg.payload as { nodeId?: unknown; text?: unknown } | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (typeof payload.text !== "string" || !payload.text.trim()) return;
      if (!canvas.findNode(payload.nodeId)) return;
      canvas.addComment({ nodeId: payload.nodeId, author: "user", text: payload.text.trim() });
      return;
    }
    case "resolve-comment": {
      const payload = msg.payload as { id?: unknown } | null;
      if (payload && typeof payload.id === "string") canvas.resolveComment(payload.id);
      return;
    }
    case "delete-comment": {
      const payload = msg.payload as { id?: unknown } | null;
      if (payload && typeof payload.id === "string") canvas.deleteComment(payload.id);
      return;
    }
    case "undo": {
      canvas.undo();
      return;
    }
    case "redo": {
      canvas.redo();
      return;
    }
    case "set-text": {
      const payload = msg.payload as
        | { nodeId?: unknown; text?: unknown }
        | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (typeof payload.text !== "string") return;
      canvas.setText(payload.nodeId, payload.text);
      return;
    }
    case "set-layer-name": {
      const payload = msg.payload as
        | { nodeId?: unknown; layerName?: unknown }
        | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (typeof payload.layerName !== "string") return;
      canvas.setLayerName(payload.nodeId, payload.layerName);
      return;
    }
    case "set-document-name": {
      const payload = msg.payload as { name?: unknown } | null;
      if (!payload || typeof payload.name !== "string") return;
      canvas.setDocumentName(payload.name);
      return;
    }
    case "create-artboard": {
      const payload = (msg.payload ?? {}) as {
        name?: unknown;
        styles?: unknown;
      };
      const name = typeof payload.name === "string" ? payload.name : undefined;
      const styles =
        payload.styles && typeof payload.styles === "object"
          ? (payload.styles as Record<string, string | number>)
          : undefined;
      const ab = canvas.createArtboard({ name, styles });
      // Auto-select the new artboard so the user sees what just appeared.
      canvas.setSelection(ab.id);
      return;
    }
    case "duplicate-artboard": {
      const payload = msg.payload as { nodeId?: unknown } | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      const ab = canvas.duplicateArtboard(payload.nodeId);
      if (ab) canvas.setSelection(ab.id);
      return;
    }
    case "reload-state": {
      void reloadFromDisk().then(() => {
        // canvas.setArtboards inside reloadFromDisk already broadcasts state,
        // but server-info has changed (stateMtime), so push that too.
        void broadcastInfo();
      });
      return;
    }
    case "reset-canvas": {
      // Recorded as an undo point — a reset must be recoverable.
      canvas.setArtboards([]);
      canvas.setSelection(null);
      return;
    }
  }
}

let broadcastInfo: () => Promise<void> = async () => {};

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}
