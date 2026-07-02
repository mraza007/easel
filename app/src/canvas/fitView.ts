import { useCanvas } from "../store";

const PADDING = 80;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/**
 * Fit the viewport to all artboards, or to one node (Shift+2) when targetId
 * is given. World bounds come from artboard geometry for the full fit and
 * from the live DOM rect for a single node.
 */
export function fitView(targetId: string | null): void {
  const host = document.querySelector(".canvas-host") as HTMLElement | null;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const bounds = targetId ? nodeBounds(targetId) : allArtboardBounds();
  if (!bounds) return;

  const { setPan, setZoom } = useCanvas.getState();
  const zoom = clamp(
    Math.min(
      (rect.width - PADDING * 2) / bounds.width,
      (rect.height - PADDING * 2) / bounds.height,
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  setZoom(zoom);
  setPan({
    x: (rect.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (rect.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  });
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function allArtboardBounds(): Bounds | null {
  const { artboards } = useCanvas.getState();
  if (artboards.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of artboards) {
    const w = parseFloat(String(a.styles?.width ?? "1200")) || 1200;
    const h = parseFloat(String(a.styles?.height ?? "720")) || 720;
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x + w);
    maxY = Math.max(maxY, a.y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function nodeBounds(id: string): Bounds | null {
  const { zoom } = useCanvas.getState();
  const target = document.querySelector(
    `[data-easel-id="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  const pannable = document.querySelector(".canvas-pannable") as HTMLElement | null;
  if (!target || !pannable) return null;
  const t = target.getBoundingClientRect();
  const p = pannable.getBoundingClientRect();
  return {
    x: (t.left - p.left) / zoom,
    y: (t.top - p.top) / zoom,
    width: t.width / zoom,
    height: t.height / zoom,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
