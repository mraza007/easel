import { useCanvas } from "../store";
import type { Artboard } from "../types";
import { dispatch } from "../rpc/handlers";

// The bridge binds the first free port in 7777-7786 (it may not get 7777 if
// another agent's MCP server got there first). Probe the range: on a failed
// attempt, advance to the next candidate before retrying.
const WS_PORT_START = 7777;
const WS_PORT_RANGE = 10;
const RETRY_MS = 1500;

let portOffset = 0;
const wsUrl = () => `ws://127.0.0.1:${WS_PORT_START + portOffset}`;

/** Active socket, exposed so callers can send mutations without re-plumbing. */
let activeWs: WebSocket | null = null;

/** Force-close the active socket; the auto-retry logic reopens within RETRY_MS. */
export function reconnectMcp(): void {
  if (activeWs && activeWs.readyState !== WebSocket.CLOSED) {
    activeWs.close();
  }
}

export type MutationOp =
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

/**
 * Send a state-mutation message upstream. The server treats these as if they
 * came from an MCP write tool: applies, broadcasts updated state.
 */
export function sendMutation(
  op: MutationOp,
  payload: Record<string, unknown>,
): boolean {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return false;
  activeWs.send(JSON.stringify({ type: "mutation", op, payload }));
  return true;
}

interface StateMessage {
  type: "state";
  payload: { artboards: Artboard[] };
}

interface RpcRequestMessage {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
}

interface SetSelectionMessage {
  type: "set-selection";
  id: string | null;
}

interface MetadataMessage {
  type: "metadata";
  payload: { documentName: string };
}

interface ServerInfoMessage {
  type: "server-info";
  payload: import("../types").ServerInfo;
}

interface DesignSystemMessage {
  type: "design-system";
  payload: import("../store").DesignSystemSummary | null;
}

interface CommentsMessage {
  type: "comments";
  payload: import("../types").CanvasComment[];
}

interface BundleMessage {
  type: "bundle";
  id: string;
  ok: boolean;
  js?: string;
  error?: string;
}

export interface BundleResult {
  ok: boolean;
  js?: string;
  error?: string;
}

let bundleCounter = 0;
const pendingBundles = new Map<string, (r: BundleResult) => void>();

/**
 * Ask the MCP server to bundle a project component for sandbox rendering.
 * Resolves {ok:false} rather than rejecting so callers render a fallback chip.
 */
export function requestBundle(
  component: string,
  props: Record<string, unknown>,
): Promise<BundleResult> {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ ok: false, error: "not connected" });
  }
  bundleCounter += 1;
  const id = `b-${bundleCounter}`;
  return new Promise((resolve) => {
    pendingBundles.set(id, resolve);
    activeWs!.send(JSON.stringify({ type: "get-bundle", id, component, props }));
    window.setTimeout(() => {
      if (pendingBundles.delete(id)) resolve({ ok: false, error: "bundle timeout" });
    }, 20000);
  });
}

type ServerMessage =
  | StateMessage
  | RpcRequestMessage
  | SetSelectionMessage
  | MetadataMessage
  | ServerInfoMessage
  | DesignSystemMessage
  | CommentsMessage
  | BundleMessage;

/**
 * Connects to the MCP server's WebSocket bridge.
 *
 * Inbound:
 *   - "state"          — canonical tree snapshot.
 *   - "rpc"            — server asking the canvas for live data.
 *   - "set-selection"  — server pushes a selection (echo of our own update,
 *                        or an agent-driven highlight via set_selection tool).
 *
 * Outbound:
 *   - "selection"      — emitted whenever the user changes selection locally.
 *   - "rpc-result/error" — RPC responses.
 *
 * Echo-loop prevention: every incoming set-selection records the value as
 * "lastEcho"; the local-change subscriber skips emitting if the new value
 * matches lastEcho (and clears it).
 */
export function connectMcp(): () => void {
  let ws: WebSocket | null = null;
  let retryTimer: number | null = null;
  let unsubscribeStore: (() => void) | null = null;
  let lastEcho: string | null | undefined = undefined;
  let lastSent: string | null | undefined = undefined;
  let lastNameEcho: string | undefined = undefined;
  let lastNameSent: string | undefined = undefined;
  let disposed = false;

  const open = () => {
    if (disposed) return;
    useCanvas.getState().setConnection("connecting");
    ws = new WebSocket(wsUrl());
    activeWs = ws;
    let opened = false;

    ws.addEventListener("open", () => {
      opened = true;
      useCanvas.getState().setConnection("connected");
      // Send current selection so the server is in sync.
      const id = useCanvas.getState().selectedId;
      lastSent = id;
      send(ws!, { type: "selection", id });
    });

    ws.addEventListener("message", async (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string) as ServerMessage;
      } catch (err) {
        console.warn("[easel] bad ws message", err);
        return;
      }
      if (msg.type === "state") {
        useCanvas.getState().setArtboards(msg.payload.artboards);
        return;
      }
      if (msg.type === "set-selection") {
        const current = useCanvas.getState().selectedId;
        if (msg.id === current) return; // already in sync
        lastEcho = msg.id;
        useCanvas.getState().setSelected(msg.id);
        return;
      }
      if (msg.type === "metadata") {
        const current = useCanvas.getState().documentName;
        if (msg.payload.documentName === current) return;
        lastNameEcho = msg.payload.documentName;
        useCanvas.getState().setDocumentName(msg.payload.documentName);
        return;
      }
      if (msg.type === "server-info") {
        useCanvas.getState().setServerInfo(msg.payload);
        return;
      }
      if (msg.type === "design-system") {
        useCanvas.getState().setDesignSystem(msg.payload);
        return;
      }
      if (msg.type === "comments") {
        useCanvas.getState().setComments(msg.payload);
        return;
      }
      if (msg.type === "bundle") {
        const resolve = pendingBundles.get(msg.id);
        if (resolve) {
          pendingBundles.delete(msg.id);
          resolve({ ok: msg.ok, js: msg.js, error: msg.error });
        }
        return;
      }
      if (msg.type === "rpc") {
        await handleRpc(ws!, msg);
        return;
      }
    });

    ws.addEventListener("close", () => {
      useCanvas.getState().setConnection("disconnected");
      if (activeWs === ws) activeWs = null;
      // Never connected on this port — try the next one in the bridge's range.
      if (!opened) portOffset = (portOffset + 1) % WS_PORT_RANGE;
      if (!disposed) retryTimer = window.setTimeout(open, RETRY_MS);
    });

    ws.addEventListener("error", () => ws?.close());
  };

  // Subscribe to local selection + documentName changes; emit unless they
  // came from the server itself (loop-prevention via lastEcho/lastSent).
  unsubscribeStore = useCanvas.subscribe((state, prevState) => {
    // Selection sync
    if (state.selectedId !== prevState.selectedId) {
      if (state.selectedId === lastEcho) {
        lastEcho = undefined;
        lastSent = state.selectedId;
      } else if (state.selectedId !== lastSent) {
        lastSent = state.selectedId;
        if (ws && ws.readyState === WebSocket.OPEN) {
          send(ws, { type: "selection", id: state.selectedId });
        }
      }
    }
    // Document name sync
    if (state.documentName !== prevState.documentName) {
      if (state.documentName === lastNameEcho) {
        lastNameEcho = undefined;
        lastNameSent = state.documentName;
      } else if (state.documentName !== lastNameSent) {
        lastNameSent = state.documentName;
        if (ws && ws.readyState === WebSocket.OPEN) {
          send(ws, {
            type: "mutation",
            op: "set-document-name",
            payload: { name: state.documentName },
          });
        }
      }
    }
  });

  open();

  return () => {
    disposed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    unsubscribeStore?.();
    ws?.close();
  };
}

async function handleRpc(ws: WebSocket, req: RpcRequestMessage) {
  try {
    const result = await dispatch(req.method, req.params);
    send(ws, { type: "rpc-result", id: req.id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: "rpc-error", id: req.id, error: message });
  }
}

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}
