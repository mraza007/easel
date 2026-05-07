import { WebSocketServer, type WebSocket } from "ws";
import { canvas } from "./state.js";
import { rpc, type RpcInbound, type RpcRequest } from "./rpc.js";
import { getServerInfo } from "./server-info.js";
import { reloadFromDisk } from "./persistence.js";

const WS_PORT = 7777;

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
    | "reload-state"
    | "reset-canvas";
  payload: unknown;
}

type Inbound = RpcInbound | SelectionInbound | MutationInbound;

/**
 * Local WebSocket bridge.
 *
 * Outbound: state snapshots (full tree), set-selection (selection sync from
 * agent to canvas), and RPC requests for things only the live DOM knows.
 * Inbound: RPC results, selection updates from the canvas.
 *
 * Bound to 127.0.0.1 — never exposed to the network.
 */
export function startBridge() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
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

    // Send server info on connect — popover renders from this snapshot.
    void getServerInfo().then((info) =>
      send(ws, { type: "server-info", payload: info }),
    );

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
      rpc.handleInbound(data);
    });

    ws.on("close", () => {
      clients.delete(ws);
      unsubscribeState();
      unsubscribeSelection();
      unsubscribeMetadata();
      refreshSender();
    });

    ws.on("error", () => {
      try {
        unsubscribeState();
        unsubscribeSelection();
        unsubscribeMetadata();
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
    t === "rpc-result" || t === "rpc-error" || t === "selection" || t === "mutation"
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
        | { nodeId?: unknown; styles?: unknown }
        | null;
      if (!payload || typeof payload.nodeId !== "string") return;
      if (!payload.styles || typeof payload.styles !== "object") return;
      canvas.updateStyles(
        payload.nodeId,
        payload.styles as Record<string, string | number>,
      );
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
