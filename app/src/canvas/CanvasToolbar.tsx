import { useCallback } from "react";
import { useCanvas } from "../store";
import { FitIcon, MinusIcon, PlusIcon } from "../ui/icons";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;

export function CanvasToolbar() {
  const zoom = useCanvas((s) => s.zoom);
  const setZoom = useCanvas((s) => s.setZoom);
  const setPan = useCanvas((s) => s.setPan);
  const artboards = useCanvas((s) => s.artboards);

  const zoomTo = useCallback(
    (next: number) => {
      const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
      // Anchor zoom on viewport center.
      const host = document.querySelector(".canvas-host") as HTMLElement | null;
      if (!host) {
        setZoom(target);
        return;
      }
      const rect = host.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const { pan } = useCanvas.getState();
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      setZoom(target);
      setPan({ x: cx - worldX * target, y: cy - worldY * target });
    },
    [zoom, setPan, setZoom],
  );

  const fitToView = useCallback(() => {
    const host = document.querySelector(".canvas-host") as HTMLElement | null;
    if (!host || artboards.length === 0) return;
    const rect = host.getBoundingClientRect();
    const PADDING = 80;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const a of artboards) {
      const w = parseSize(a.styles?.width) ?? 1200;
      const h = parseSize(a.styles?.height) ?? 720;
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x + w);
      maxY = Math.max(maxY, a.y + h);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = rect.width - PADDING * 2;
    const availH = rect.height - PADDING * 2;
    const target = clamp(
      Math.min(availW / contentW, availH / contentH),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    setZoom(target);
    setPan({
      x: (rect.width - contentW * target) / 2 - minX * target,
      y: (rect.height - contentH * target) / 2 - minY * target,
    });
  }, [artboards, setPan, setZoom]);

  return (
    <div className="canvas-toolbar">
      <button
        className="tool-btn"
        title="Zoom out"
        onClick={() => zoomTo(zoom / ZOOM_STEP)}
      >
        <MinusIcon />
      </button>
      <button
        className="tool-btn zoom-readout"
        title="Reset zoom to 100%"
        onClick={() => zoomTo(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="tool-btn"
        title="Zoom in"
        onClick={() => zoomTo(zoom * ZOOM_STEP)}
      >
        <PlusIcon />
      </button>
      <span className="tool-divider" aria-hidden />
      <button
        className="tool-btn"
        title="Fit all artboards"
        onClick={fitToView}
      >
        <FitIcon />
      </button>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function parseSize(value: string | number | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
