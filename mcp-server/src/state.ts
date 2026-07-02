/**
 * In-memory canonical canvas state. The MCP server is the source of truth;
 * connected web apps subscribe and re-render. When an agent calls write_html
 * or update_styles, we mutate state here and broadcast.
 */
import type { Artboard, CanvasComment, PaperNode } from "./types.js";

type Subscriber = (state: { artboards: Artboard[] }) => void;
type SelectionSubscriber = (id: string | null) => void;
type MetadataSubscriber = (meta: { documentName: string }) => void;
type CommentsSubscriber = (comments: CanvasComment[]) => void;

const HISTORY_LIMIT = 100;

class CanvasState {
  private artboards: Artboard[] = [];
  // Undo history. Snapshots are cheap: the tree is immutable, so each entry
  // is just an array of references. Loading from disk clears history.
  private past: Artboard[][] = [];
  private future: Artboard[][] = [];
  private subscribers = new Set<Subscriber>();
  private selectionSubscribers = new Set<SelectionSubscriber>();
  private metadataSubscribers = new Set<MetadataSubscriber>();
  private selectedId: string | null = null;
  private documentName = "untitled.easel";
  private idCounter = 0;

  getArtboards(): Artboard[] {
    return this.artboards;
  }

  /**
   * Wholesale replacement. Records an undo point by default so reset_canvas
   * is recoverable; disk loads pass clearHistory to start fresh.
   */
  setArtboards(next: Artboard[], opts: { clearHistory?: boolean } = {}) {
    if (opts.clearHistory) {
      this.past = [];
      this.future = [];
    } else {
      this.checkpoint();
    }
    this.artboards = next;
    this.notify();
  }

  /** Record the current tree as an undo point. Call before every mutation. */
  private checkpoint() {
    this.past.push(this.artboards);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.artboards);
    this.artboards = prev;
    this.notify();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.artboards);
    this.artboards = next;
    this.notify();
    return true;
  }

  historyDepth(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }

  /**
   * Move a node one position among its siblings (direction -1 = earlier,
   * +1 = later). Works for artboards (canvas order) and nested nodes.
   */
  reorderNode(nodeId: string, direction: -1 | 1): boolean {
    // Top-level artboard?
    const idx = this.artboards.findIndex((a) => a.id === nodeId);
    if (idx !== -1) {
      const to = idx + direction;
      if (to < 0 || to >= this.artboards.length) return false;
      this.checkpoint();
      const next = this.artboards.slice();
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved!);
      this.artboards = next;
      this.notify();
      return true;
    }
    return this.mutateTree((a) => {
      const r = reorderIn(a, nodeId, direction);
      return { node: r.node, updated: r.moved };
    }, "updated");
  }

  /** Reposition a top-level artboard on the canvas. */
  moveArtboard(nodeId: string, x: number, y: number): boolean {
    const idx = this.artboards.findIndex((a) => a.id === nodeId);
    if (idx === -1) return false;
    const orig = this.artboards[idx]!;
    if (orig.x === x && orig.y === y) return true;
    this.checkpoint();
    const next = this.artboards.slice();
    next[idx] = { ...orig, x, y };
    this.artboards = next;
    this.notify();
    return true;
  }

  upsertArtboard(ab: Artboard) {
    this.checkpoint();
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
    this.checkpoint();
    this.artboards = this.artboards.map(
      (a) => insertInto(a, parentId, children) as Artboard,
    );
    this.notify();
  }

  replaceNode(nodeId: string, replacement: PaperNode): boolean {
    return this.mutateTree((a) => replaceIn(a, nodeId, replacement), "replaced");
  }

  updateStyles(nodeId: string, styles: Record<string, string | number>): boolean {
    return this.mutateTree((a) => patchStyles(a, nodeId, styles), "updated");
  }

  /** Patch several nodes as ONE history entry (inspector multi-select edits). */
  updateStylesMany(
    nodeIds: string[],
    styles: Record<string, string | number>,
  ): { updated: string[]; missing: string[] } {
    const prev = this.artboards;
    const updated: string[] = [];
    const missing: string[] = [];
    let tree = prev;
    for (const id of nodeIds) {
      let hit = false;
      tree = tree.map((a) => {
        const r = patchStyles(a, id, styles);
        if (r.updated) hit = true;
        return r.node as Artboard;
      });
      (hit ? updated : missing).push(id);
    }
    if (updated.length > 0) {
      this.past.push(prev);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
      this.artboards = tree;
      this.notify();
    }
    return { updated, missing };
  }

  setText(nodeId: string, text: string): boolean {
    return this.mutateTree((a) => patchText(a, nodeId, text), "updated");
  }

  setLayerName(nodeId: string, layerName: string): boolean {
    return this.mutateTree((a) => patchLayerName(a, nodeId, layerName), "updated");
  }

  /**
   * Apply a per-artboard transform; if any artboard reports a change, record
   * the previous tree as an undo point and broadcast.
   */
  private mutateTree(
    fn: (a: Artboard) => { node: PaperNode; replaced?: boolean; updated?: boolean },
    flag: "replaced" | "updated",
  ): boolean {
    const prev = this.artboards;
    let changed = false;
    const next = prev.map((a) => {
      const result = fn(a);
      if (result[flag]) changed = true;
      return result.node as Artboard;
    });
    if (!changed) return false;
    this.past.push(prev);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.artboards = next;
    this.notify();
    return true;
  }

  // ---------- comments ----------
  private comments: CanvasComment[] = [];
  private commentsSubscribers = new Set<CommentsSubscriber>();

  getComments(nodeId?: string): CanvasComment[] {
    return nodeId
      ? this.comments.filter((c) => c.nodeId === nodeId)
      : this.comments;
  }

  /** Comments are not part of undo history — they're a conversation, not the design. */
  addComment(input: {
    nodeId: string;
    author: CanvasComment["author"];
    text: string;
  }): CanvasComment {
    let id = this.nextId("c");
    while (this.comments.some((c) => c.id === id)) id = this.nextId("c");
    const comment: CanvasComment = {
      id,
      nodeId: input.nodeId,
      author: input.author,
      text: input.text,
      createdAt: Date.now(),
    };
    this.comments = [...this.comments, comment];
    this.notifyComments();
    return comment;
  }

  resolveComment(id: string): boolean {
    const idx = this.comments.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    const next = this.comments.slice();
    next[idx] = { ...next[idx]!, resolved: true };
    this.comments = next;
    this.notifyComments();
    return true;
  }

  deleteComment(id: string): boolean {
    const before = this.comments.length;
    this.comments = this.comments.filter((c) => c.id !== id);
    if (this.comments.length === before) return false;
    this.notifyComments();
    return true;
  }

  setComments(comments: CanvasComment[]): void {
    this.comments = comments;
    this.notifyComments();
  }

  subscribeComments(fn: CommentsSubscriber): () => void {
    this.commentsSubscribers.add(fn);
    fn(this.comments);
    return () => this.commentsSubscribers.delete(fn);
  }

  private notifyComments(): void {
    for (const fn of this.commentsSubscribers) fn(this.comments);
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
    this.checkpoint();
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
    this.checkpoint();
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
      this.checkpoint();
      this.artboards = filtered;
      this.notify();
      return true;
    }
    return this.mutateTree((a) => {
      const r = removeIn(a, nodeId);
      return { node: r.node, updated: r.removed };
    }, "updated");
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

function reorderIn(
  node: PaperNode,
  targetId: string,
  direction: -1 | 1,
): { node: PaperNode; moved: boolean } {
  if (!node.children) return { node, moved: false };
  const idx = node.children.findIndex((c) => c.id === targetId);
  if (idx !== -1) {
    const to = idx + direction;
    if (to < 0 || to >= node.children.length) return { node, moved: false };
    const children = node.children.slice();
    const [moved] = children.splice(idx, 1);
    children.splice(to, 0, moved!);
    return { node: { ...node, children }, moved: true };
  }
  let moved = false;
  const children = node.children.map((c) => {
    const r = reorderIn(c, targetId, direction);
    if (r.moved) moved = true;
    return r.node;
  });
  return { node: moved ? { ...node, children } : node, moved };
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
