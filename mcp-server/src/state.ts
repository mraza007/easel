/**
 * In-memory canonical canvas state. The MCP server is the source of truth;
 * connected web apps subscribe and re-render. When an agent calls write_html
 * or update_styles, we mutate state here and broadcast.
 */
import type { Artboard, PaperNode } from "./types.js";

type Subscriber = (state: { artboards: Artboard[] }) => void;
type SelectionSubscriber = (id: string | null) => void;
type MetadataSubscriber = (meta: { documentName: string }) => void;

class CanvasState {
  private artboards: Artboard[] = [];
  private subscribers = new Set<Subscriber>();
  private selectionSubscribers = new Set<SelectionSubscriber>();
  private metadataSubscribers = new Set<MetadataSubscriber>();
  private selectedId: string | null = null;
  private documentName = "untitled.easel";
  private idCounter = 0;

  getArtboards(): Artboard[] {
    return this.artboards;
  }

  setArtboards(next: Artboard[]) {
    this.artboards = next;
    this.notify();
  }

  upsertArtboard(ab: Artboard) {
    const idx = this.artboards.findIndex((a) => a.id === ab.id);
    if (idx === -1) this.artboards = [...this.artboards, ab];
    else {
      const next = this.artboards.slice();
      next[idx] = ab;
      this.artboards = next;
    }
    this.notify();
  }

  appendChildren(parentId: string, children: PaperNode[]) {
    this.artboards = this.artboards.map(
      (a) => insertInto(a, parentId, children) as Artboard,
    );
    this.notify();
  }

  replaceNode(nodeId: string, replacement: PaperNode): boolean {
    let replaced = false;
    this.artboards = this.artboards.map((a) => {
      const result = replaceIn(a, nodeId, replacement);
      if (result.replaced) replaced = true;
      return result.node as Artboard;
    });
    if (replaced) this.notify();
    return replaced;
  }

  updateStyles(nodeId: string, styles: Record<string, string | number>): boolean {
    let updated = false;
    this.artboards = this.artboards.map((a) => {
      const result = patchStyles(a, nodeId, styles);
      if (result.updated) updated = true;
      return result.node as Artboard;
    });
    if (updated) this.notify();
    return updated;
  }

  setText(nodeId: string, text: string): boolean {
    let updated = false;
    this.artboards = this.artboards.map((a) => {
      const result = patchText(a, nodeId, text);
      if (result.updated) updated = true;
      return result.node as Artboard;
    });
    if (updated) this.notify();
    return updated;
  }

  setLayerName(nodeId: string, layerName: string): boolean {
    let updated = false;
    this.artboards = this.artboards.map((a) => {
      const result = patchLayerName(a, nodeId, layerName);
      if (result.updated) updated = true;
      return result.node as Artboard;
    });
    if (updated) this.notify();
    return updated;
  }

  // ---------- document metadata ----------
  getDocumentName(): string {
    return this.documentName;
  }

  setDocumentName(name: string): void {
    const next = name.trim() || "untitled.easel";
    if (next === this.documentName) return;
    this.documentName = next;
    this.notifyMetadata();
  }

  subscribeMetadata(fn: MetadataSubscriber): () => void {
    this.metadataSubscribers.add(fn);
    fn({ documentName: this.documentName });
    return () => this.metadataSubscribers.delete(fn);
  }

  private notifyMetadata(): void {
    const snapshot = { documentName: this.documentName };
    for (const fn of this.metadataSubscribers) fn(snapshot);
  }

  /**
   * Create a new artboard, placing it to the right of the rightmost existing
   * artboard (or at the canvas origin if empty). Default size: 1200x720.
   */
  createArtboard(opts: {
    name?: string;
    styles?: Record<string, string | number>;
  } = {}): Artboard {
    const id = this.nextId("ab");
    const x = computeNextX(this.artboards);
    const y = 80;
    const ab: Artboard = {
      id,
      tag: "artboard",
      layerName: opts.name ?? "Artboard",
      x,
      y,
      styles: {
        width: "1200px",
        height: "720px",
        padding: "48px",
        ...(opts.styles ?? {}),
      },
      children: [],
    };
    this.artboards = [...this.artboards, ab];
    this.notify();
    return ab;
  }

  /**
   * Deep-clone an artboard with fresh ids at every level, placed to the right
   * of the original. Returns the new artboard.
   */
  duplicateArtboard(nodeId: string): Artboard | null {
    const orig = this.artboards.find((a) => a.id === nodeId);
    if (!orig) return null;
    const cloned = this.cloneTreeWithNewIds(orig) as Artboard;
    cloned.layerName = `${orig.layerName ?? "Artboard"} copy`;
    // Place to the right of every existing artboard so duplicates and new
    // artboards never overlap. Drag-to-move (future) lets users rearrange.
    cloned.x = computeNextX(this.artboards);
    cloned.y = orig.y;
    this.artboards = [...this.artboards, cloned];
    this.notify();
    return cloned;
  }

  private cloneTreeWithNewIds(node: PaperNode): PaperNode {
    const prefix = node.tag === "artboard" ? "ab" : node.tag;
    return {
      ...node,
      id: this.nextId(prefix),
      children: node.children?.map((c) => this.cloneTreeWithNewIds(c)),
    };
  }

  findNode(nodeId: string): PaperNode | null {
    for (const a of this.artboards) {
      const found = findInTree(a, nodeId);
      if (found) return found;
    }
    return null;
  }

  deleteNode(nodeId: string): boolean {
    // Top-level artboards are removed wholesale.
    const before = this.artboards.length;
    const filtered = this.artboards.filter((a) => a.id !== nodeId);
    if (filtered.length !== before) {
      this.artboards = filtered;
      this.notify();
      return true;
    }
    let removed = false;
    this.artboards = this.artboards.map((a) => {
      const result = removeIn(a, nodeId);
      if (result.removed) removed = true;
      return result.node as Artboard;
    });
    if (removed) this.notify();
    return removed;
  }

  nextId(prefix: string): string {
    // Loop until we generate an id that doesn't already exist in the tree.
    // This handles the case where state.json was loaded with ids like
    // ab-1, ab-2, ab-3 — a fresh idCounter (0) would re-generate them.
    while (true) {
      this.idCounter += 1;
      const id = `${prefix}-${this.idCounter.toString(36)}`;
      if (!this.findNode(id)) return id;
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    fn({ artboards: this.artboards });
    return () => this.subscribers.delete(fn);
  }

  // ---------- selection ----------
  getSelectedId(): string | null {
    return this.selectedId;
  }

  /**
   * Set selection and notify all subscribers (including the originating
   * canvas, which is fine: clients dedupe by tracking the last value they
   * sent). Used both when the canvas reports a user-driven selection and
   * when an agent calls set_selection.
   */
  setSelection(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const fn of this.selectionSubscribers) fn(id);
  }

  subscribeSelection(fn: SelectionSubscriber): () => void {
    this.selectionSubscribers.add(fn);
    fn(this.selectedId);
    return () => this.selectionSubscribers.delete(fn);
  }

  private notify() {
    const snapshot = { artboards: this.artboards };
    for (const fn of this.subscribers) fn(snapshot);
  }
}

function insertInto(
  node: PaperNode,
  parentId: string,
  toAdd: PaperNode[],
): PaperNode {
  if (node.id === parentId) {
    return { ...node, children: [...(node.children ?? []), ...toAdd] };
  }
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => insertInto(c, parentId, toAdd)) };
}

function replaceIn(
  node: PaperNode,
  targetId: string,
  replacement: PaperNode,
): { node: PaperNode; replaced: boolean } {
  if (node.id === targetId) return { node: replacement, replaced: true };
  if (!node.children) return { node, replaced: false };
  let replaced = false;
  const children = node.children.map((c) => {
    const r = replaceIn(c, targetId, replacement);
    if (r.replaced) replaced = true;
    return r.node;
  });
  return { node: replaced ? { ...node, children } : node, replaced };
}

function patchStyles(
  node: PaperNode,
  targetId: string,
  styles: Record<string, string | number>,
): { node: PaperNode; updated: boolean } {
  if (node.id === targetId) {
    return {
      node: { ...node, styles: { ...(node.styles ?? {}), ...styles } },
      updated: true,
    };
  }
  if (!node.children) return { node, updated: false };
  let updated = false;
  const children = node.children.map((c) => {
    const r = patchStyles(c, targetId, styles);
    if (r.updated) updated = true;
    return r.node;
  });
  return { node: updated ? { ...node, children } : node, updated };
}

function removeIn(
  node: PaperNode,
  targetId: string,
): { node: PaperNode; removed: boolean } {
  if (!node.children) return { node, removed: false };
  let removed = false;
  const filtered = node.children.filter((c) => {
    if (c.id === targetId) {
      removed = true;
      return false;
    }
    return true;
  });
  if (removed) return { node: { ...node, children: filtered }, removed };
  const recursed = node.children.map((c) => {
    const r = removeIn(c, targetId);
    if (r.removed) removed = true;
    return r.node;
  });
  return { node: removed ? { ...node, children: recursed } : node, removed };
}

function patchText(
  node: PaperNode,
  targetId: string,
  text: string,
): { node: PaperNode; updated: boolean } {
  if (node.id === targetId) {
    return { node: { ...node, text }, updated: true };
  }
  if (!node.children) return { node, updated: false };
  let updated = false;
  const children = node.children.map((c) => {
    const r = patchText(c, targetId, text);
    if (r.updated) updated = true;
    return r.node;
  });
  return { node: updated ? { ...node, children } : node, updated };
}

function patchLayerName(
  node: PaperNode,
  targetId: string,
  layerName: string,
): { node: PaperNode; updated: boolean } {
  if (node.id === targetId) {
    return { node: { ...node, layerName }, updated: true };
  }
  if (!node.children) return { node, updated: false };
  let updated = false;
  const children = node.children.map((c) => {
    const r = patchLayerName(c, targetId, layerName);
    if (r.updated) updated = true;
    return r.node;
  });
  return { node: updated ? { ...node, children } : node, updated };
}

function computeNextX(artboards: Artboard[]): number {
  if (artboards.length === 0) return 80;
  let maxRight = 0;
  for (const a of artboards) {
    const w = parseFloat(String(a.styles?.width ?? "1200")) || 1200;
    maxRight = Math.max(maxRight, a.x + w);
  }
  return maxRight + 80;
}

function findInTree(node: PaperNode, id: string): PaperNode | null {
  if (node.id === id) return node;
  if (!node.children) return null;
  for (const c of node.children) {
    const found = findInTree(c, id);
    if (found) return found;
  }
  return null;
}

export const canvas = new CanvasState();
