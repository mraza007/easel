import { create } from "zustand";
import type {
  Artboard,
  CanvasComment,
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
  /** Primary selection — synced with the MCP server (single-id protocol). */
  selectedId: string | null;
  /** Full selection set; selectedIds[0] === selectedId. Extras are local-only. */
  selectedIds: string[];
  documentName: string;
  serverInfo: ServerInfo | null;
  designSystem: DesignSystemSummary | null;
  insertOpen: boolean;
  comments: CanvasComment[];

  setPan: (pan: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  setArtboards: (artboards: Artboard[]) => void;
  upsertArtboard: (artboard: Artboard) => void;
  appendChildren: (parentId: string, children: PaperNode[]) => void;
  setConnection: (s: ConnectionStatus) => void;
  setSelected: (id: string | null) => void;
  /** Shift-click: add/remove from the selection set. */
  toggleSelected: (id: string) => void;
  setDocumentName: (name: string) => void;
  setServerInfo: (info: ServerInfo | null) => void;
  setDesignSystem: (ds: DesignSystemSummary | null) => void;
  setInsertOpen: (open: boolean) => void;
  setComments: (comments: CanvasComment[]) => void;
  /** Optimistic drag update; the server mutation is sent on release. */
  moveArtboardLocal: (id: string, x: number, y: number) => void;
  /** Optimistic resize/inspector update; server mutation follows. */
  patchStylesLocal: (ids: string[], styles: Record<string, string | number>) => void;
}

export interface DesignSystemSummary {
  framework: string;
  customProperties: Record<string, string>;
  components: {
    name: string;
    filePath: string;
    props?: string[];
    variants?: Record<string, string[]>;
  }[];
}

export const useCanvas = create<CanvasStore>((set) => ({
  artboards: SAMPLE_ARTBOARDS,
  pan: { x: 0, y: 0 },
  zoom: 0.6,
  connection: "disconnected",
  selectedId: null,
  selectedIds: [],
  documentName: "untitled.easel",
  serverInfo: null,
  designSystem: null,
  insertOpen: false,
  comments: [],

  setPan: (pan) => set({ pan }),
  setZoom: (zoom) => set({ zoom }),
  setArtboards: (artboards) => set({ artboards }),
  setConnection: (connection) => set({ connection }),
  setSelected: (selectedId) =>
    set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),
  toggleSelected: (id) =>
    set((s) => {
      const ids = s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id];
      return { selectedIds: ids, selectedId: ids[0] ?? null };
    }),
  setDocumentName: (documentName) => set({ documentName }),
  setServerInfo: (serverInfo) => set({ serverInfo }),
  setDesignSystem: (designSystem) => set({ designSystem }),
  setInsertOpen: (insertOpen) => set({ insertOpen }),
  setComments: (comments) => set({ comments }),

  moveArtboardLocal: (id, x, y) =>
    set((s) => ({
      artboards: s.artboards.map((a) => (a.id === id ? { ...a, x, y } : a)),
    })),

  patchStylesLocal: (ids, styles) =>
    set((s) => ({
      artboards: s.artboards.map(
        (a) => patchStylesIn(a, new Set(ids), styles) as Artboard,
      ),
    })),

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

export function findNode(artboards: Artboard[], id: string | null): PaperNode | null {
  if (!id) return null;
  for (const a of artboards) {
    const found = findIn(a, id);
    if (found) return found;
  }
  return null;
}

function findIn(node: PaperNode, id: string): PaperNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const found = findIn(c, id);
    if (found) return found;
  }
  return null;
}

function patchStylesIn(
  node: PaperNode,
  ids: Set<string>,
  styles: Record<string, string | number>,
): PaperNode {
  const self = ids.has(node.id)
    ? { ...node, styles: { ...(node.styles ?? {}), ...styles } }
    : node;
  if (!self.children) return self;
  return { ...self, children: self.children.map((c) => patchStylesIn(c, ids, styles)) };
}

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
