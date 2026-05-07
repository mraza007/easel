import { randomUUID } from "node:crypto";

/**
 * Server-initiated RPC over the canvas WebSocket. The server holds canonical
 * tree state, but for things only the live DOM knows (computed styles,
 * screenshots) it needs to ask the canvas. This is that ask.
 */

export interface RpcRequest {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
}

export interface RpcResultMessage {
  type: "rpc-result";
  id: string;
  result: unknown;
}

export interface RpcErrorMessage {
  type: "rpc-error";
  id: string;
  error: string;
}

export type RpcInbound = RpcResultMessage | RpcErrorMessage;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Sender = (msg: RpcRequest) => boolean;

class RpcDispatcher {
  private pending = new Map<string, Pending>();
  private sender: Sender | null = null;

  /** Bridge sets this whenever a client is available. null means no canvas. */
  setSender(sender: Sender | null) {
    if (!sender) {
      // Reject everything in-flight so callers don't hang.
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Canvas disconnected"));
      }
      this.pending.clear();
    }
    this.sender = sender;
  }

  hasClient(): boolean {
    return this.sender !== null;
  }

  async call<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs = 5000,
  ): Promise<T> {
    if (!this.sender) {
      throw new Error(
        "No canvas connected. Open Easel at http://localhost:5173 and try again.",
      );
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      const ok = this.sender!({ type: "rpc", id, method, params });
      if (!ok) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Failed to send RPC: socket closed"));
      }
    });
  }

  handleInbound(msg: RpcInbound): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.type === "rpc-result") pending.resolve(msg.result);
    else pending.reject(new Error(msg.error));
  }
}

export const rpc = new RpcDispatcher();
