import { create } from "zustand";
import type {
  Artboard,
  ConnectionStatus,
  PaperNode,
  ServerInfo,
} from "./types";
import { SAMPLE_ARTBOARDS } from "./canvas/sample";

interface CanvasStore {
  artboards: Artboard[];
  pan: { x: number; y: number };
  zoom: number;
  connection: ConnectionStatus;
  selectedId: string | null;
  documentName: string;
  serverInfo: ServerInfo | null;

  setPan: (pan: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  setArtboards: (artboards: Artboard[]) => void;
  upsertArtboard: (artboard: Artboard) => void;
  appendChildren: (parentId: string, children: PaperNode[]) => void;
  setConnection: (s: ConnectionStatus) => void;
  setSelected: (id: string | null) => void;
  setDocumentName: (name: string) => void;
  setServerInfo: (info: ServerInfo | null) => void;
}

export const useCanvas = create<CanvasStore>((set) => ({
  artboards: SAMPLE_ARTBOARDS,
  pan: { x: 0, y: 0 },
  zoom: 0.6,
  connection: "disconnected",
  selectedId: null,
  documentName: "untitled.easel",
  serverInfo: null,

  setPan: (pan) => set({ pan }),
  setZoom: (zoom) => set({ zoom }),
  setArtboards: (artboards) => set({ artboards }),
  setConnection: (connection) => set({ connection }),
  setSelected: (selectedId) => set({ selectedId }),
  setDocumentName: (documentName) => set({ documentName }),
  setServerInfo: (serverInfo) => set({ serverInfo }),

  upsertArtboard: (artboard) =>
    set((s) => {
      const idx = s.artboards.findIndex((a) => a.id === artboard.id);
      if (idx === -1) return { artboards: [...s.artboards, artboard] };
      const next = s.artboards.slice();
      next[idx] = artboard;
      return { artboards: next };
    }),

  appendChildren: (parentId, children) =>
    set((s) => ({
      artboards: s.artboards.map((a) => insertInto(a, parentId, children) as Artboard),
    })),
}));

function insertInto(node: PaperNode, parentId: string, toAdd: PaperNode[]): PaperNode {
  if (node.id === parentId) {
    return { ...node, children: [...(node.children ?? []), ...toAdd] };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((c) => insertInto(c, parentId, toAdd)),
  };
}
