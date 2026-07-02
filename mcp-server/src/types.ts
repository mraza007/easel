export type NodeId = string;

export type StyleObject = Record<string, string | number>;

export interface PaperNode {
  id: NodeId;
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
  /** Id of the artboard this one is a responsive variant of. */
  variantOf?: string;
  /** Variant label, e.g. "mobile" or "768". */
  breakpoint?: string;
}

export interface CanvasComment {
  id: string;
  nodeId: string;
  author: "agent" | "user";
  text: string;
  createdAt: number;
  resolved?: boolean;
}
