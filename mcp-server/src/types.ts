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
}
