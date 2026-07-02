import type { PaperNode } from "./types.js";

export interface NodeDiff {
  /** Path like "root > div.hero > h1" for human/agent orientation. */
  path: string;
  a?: string;
  b?: string;
  kind: "added" | "removed" | "changed";
  styleChanges?: Record<string, { from: string | number | null; to: string | number | null }>;
  textChange?: { from: string | null; to: string | null };
  tagChange?: { from: string; to: string };
}

/**
 * Structural + style diff between two subtrees (typically two artboards —
 * e.g. iterations of the same design, or desktop vs mobile variants).
 * Children are matched pairwise by position and tag; ids are expected to
 * differ between the trees and are reported, not matched on.
 */
export function diffTrees(a: PaperNode, b: PaperNode): NodeDiff[] {
  const out: NodeDiff[] = [];
  walk(a, b, label(a), out);
  return out;
}

function walk(a: PaperNode, b: PaperNode, path: string, out: NodeDiff[]): void {
  const diff: NodeDiff = { path, a: a.id, b: b.id, kind: "changed" };
  let changed = false;

  if (a.tag !== b.tag) {
    diff.tagChange = { from: a.tag, to: b.tag };
    changed = true;
  }
  if ((a.text ?? null) !== (b.text ?? null)) {
    diff.textChange = { from: a.text ?? null, to: b.text ?? null };
    changed = true;
  }

  const styleChanges: NodeDiff["styleChanges"] = {};
  const props = new Set([
    ...Object.keys(a.styles ?? {}),
    ...Object.keys(b.styles ?? {}),
  ]);
  for (const p of props) {
    const from = a.styles?.[p] ?? null;
    const to = b.styles?.[p] ?? null;
    if (from !== to) styleChanges[p] = { from, to };
  }
  if (Object.keys(styleChanges).length > 0) {
    diff.styleChanges = styleChanges;
    changed = true;
  }

  if (changed) out.push(diff);

  const aKids = a.children ?? [];
  const bKids = b.children ?? [];
  const shared = Math.min(aKids.length, bKids.length);
  for (let i = 0; i < shared; i++) {
    walk(aKids[i]!, bKids[i]!, `${path} > ${label(bKids[i]!)}`, out);
  }
  for (let i = shared; i < aKids.length; i++) {
    out.push({
      path: `${path} > ${label(aKids[i]!)}`,
      a: aKids[i]!.id,
      kind: "removed",
    });
  }
  for (let i = shared; i < bKids.length; i++) {
    out.push({
      path: `${path} > ${label(bKids[i]!)}`,
      b: bKids[i]!.id,
      kind: "added",
    });
  }
}

function label(n: PaperNode): string {
  return n.layerName ? `${n.tag}"${n.layerName}"` : n.tag;
}
