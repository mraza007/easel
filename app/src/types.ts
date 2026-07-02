export type NodeId = string;

export type StyleObject = Record<string, string | number>;

export interface PaperNode {
  id: NodeId;
  /**
   * HTML-ish tag ("div", "h1", "button", "img", "svg"...) OR the special tag
   * "artboard" for top-level frames. Anything else renders as the same DOM tag.
   */
  tag: string;
  styles?: StyleObject;
  text?: string;
  children?: PaperNode[];
  layerName?: string;
  attrs?: Record<string, string>;
}

export interface Artboard extends PaperNode {
  tag: "artboard";
  x: number;
  y: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface CanvasComment {
  id: string;
  nodeId: string;
  author: "agent" | "user";
  text: string;
  createdAt: number;
  resolved?: boolean;
}

export interface ServerInfo {
  pid: number;
  startedAt: number;
  version: string;
  statePath: string;
  stateMtime: number | null;
}
