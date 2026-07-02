import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useCanvas } from "../store";
import { NodeRenderer } from "./NodeRenderer";
import { CanvasToolbar } from "./CanvasToolbar";
import { SelectionOverlay } from "./SelectionOverlay";
import { InsertPalette } from "./InsertPalette";
import { CommentPins } from "./CommentPins";
import { sendMutation } from "../ws/client";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.1;
const CLICK_THRESHOLD = 4; // px movement before we treat as a drag

export function Canvas() {
  const artboards = useCanvas((s) => s.artboards);
  const pan = useCanvas((s) => s.pan);
  const zoom = useCanvas((s) => s.zoom);
  const setPan = useCanvas((s) => s.setPan);
  const setZoom = useCanvas((s) => s.setZoom);
  const setSelected = useCanvas((s) => s.setSelected);
  const toggleSelected = useCanvas((s) => s.toggleSelected);
  const insertOpen = useCanvas((s) => s.insertOpen);
  const setInsertOpen = useCanvas((s) => s.setInsertOpen);
  const moveArtboardLocal = useCanvas((s) => s.moveArtboardLocal);

  // In-flight artboard move: pointer start, artboard origin, latest position.
  const moveRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    curX: number;
    curY: number;
    w: number;
    h: number;
    moved: boolean;
  } | null>(null);

  // Active snap guide lines (world coords), rendered during a drag.
  const [guides, setGuides] = useState<{ axis: "v" | "h"; pos: number }[]>([]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only pan when clicking the empty canvas (not on an artboard or its content).
      if (target.closest(".artboard")) return;
      setDragging(true);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
        moved: false,
      };
      hostRef.current?.setPointerCapture(e.pointerId);
    },
    [pan.x, pan.y],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) {
        dragRef.current.moved = true;
      }
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    },
    [setPan],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasClick = dragRef.current && !dragRef.current.moved;
      setDragging(false);
      dragRef.current = null;
      hostRef.current?.releasePointerCapture(e.pointerId);
      // Empty-canvas click clears selection.
      if (wasClick) setSelected(null);
    },
    [setSelected],
  );

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const host = hostRef.current;
        if (!host) return;
        const rect = host.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const worldX = (mx - pan.x) / zoom;
        const worldY = (my - pan.y) / zoom;
        setZoom(nextZoom);
        setPan({ x: mx - worldX * nextZoom, y: my - worldY * nextZoom });
      } else {
        setPan({ x: pan.x - e.deltaX, y: pan.y - e.deltaY });
      }
    },
    [pan.x, pan.y, zoom, setPan, setZoom],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    host.addEventListener("wheel", handler, { passive: false });
    return () => host.removeEventListener("wheel", handler);
  }, []);

  const transform: CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  };

  const handleArtboardClick = (id: string) => (e: MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) toggleSelected(id);
    else setSelected(id);
  };

  const handleNodeSelect = (id: string, additive: boolean) => {
    if (additive) toggleSelected(id);
    else setSelected(id);
  };

  /**
   * Drag-to-move an artboard. Starts on the artboard surface or its label —
   * not on child nodes, so content clicks still select content. Position
   * updates optimistically during the drag; the server mutation (one undo
   * entry) is sent on release.
   */
  const handleArtboardPointerDown =
    (ab: { id: string; x: number; y: number }) =>
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const surface = e.currentTarget as HTMLElement;
      // Child node under the pointer? Let selection/edit handle it.
      const hit = target.closest("[data-easel-id]");
      if (hit && hit !== surface && !target.closest(".artboard-label")) return;
      e.stopPropagation();
      const full = artboards.find((a) => a.id === ab.id);
      moveRef.current = {
        id: ab.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: ab.x,
        origY: ab.y,
        curX: ab.x,
        curY: ab.y,
        w: parseFloat(String(full?.styles?.width ?? "1200")) || 1200,
        h: parseFloat(String(full?.styles?.height ?? "720")) || 720,
        moved: false,
      };
      surface.setPointerCapture(e.pointerId);
    };

  const handleArtboardPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = moveRef.current;
    if (!m) return;
    const dx = (e.clientX - m.startX) / zoom;
    const dy = (e.clientY - m.startY) / zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) m.moved = true;
    if (!m.moved) return;
    let nx = Math.round(m.origX + dx);
    let ny = Math.round(m.origY + dy);

    // Snap dragged edges to other artboards' edges. Threshold is constant
    // on screen (8px) so snapping doesn't get sticky when zoomed out.
    const threshold = 8 / zoom;
    const nextGuides: { axis: "v" | "h"; pos: number }[] = [];
    let bestV: { delta: number; pos: number; adjusted: number } | null = null;
    let bestH: { delta: number; pos: number; adjusted: number } | null = null;
    for (const other of artboards) {
      if (other.id === m.id) continue;
      const ow = parseFloat(String(other.styles?.width ?? "1200")) || 1200;
      const oh = parseFloat(String(other.styles?.height ?? "720")) || 720;
      for (const edge of [other.x, other.x + ow]) {
        for (const [mine, offset] of [
          [nx, 0],
          [nx + m.w, -m.w],
        ] as const) {
          const delta = Math.abs(mine - edge);
          if (delta < threshold && (!bestV || delta < bestV.delta)) {
            bestV = { delta, pos: edge, adjusted: edge + offset };
          }
        }
      }
      for (const edge of [other.y, other.y + oh]) {
        for (const [mine, offset] of [
          [ny, 0],
          [ny + m.h, -m.h],
        ] as const) {
          const delta = Math.abs(mine - edge);
          if (delta < threshold && (!bestH || delta < bestH.delta)) {
            bestH = { delta, pos: edge, adjusted: edge + offset };
          }
        }
      }
    }
    if (bestV) {
      nx = bestV.adjusted;
      nextGuides.push({ axis: "v", pos: bestV.pos });
    }
    if (bestH) {
      ny = bestH.adjusted;
      nextGuides.push({ axis: "h", pos: bestH.pos });
    }
    setGuides(nextGuides);

    m.curX = nx;
    m.curY = ny;
    moveArtboardLocal(m.id, nx, ny);
  };

  const handleArtboardPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = moveRef.current;
    if (!m) return;
    moveRef.current = null;
    setGuides([]);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (m.moved) {
      sendMutation("move-artboard", { nodeId: m.id, x: m.curX, y: m.curY });
    }
  };

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      <div className="canvas-pannable" style={transform}>
        {artboards.map((ab) => (
          <div
            key={ab.id}
            className="artboard"
            style={{ left: ab.x, top: ab.y, ...(ab.styles ?? {}) }}
            data-easel-id={ab.id}
            onClick={handleArtboardClick(ab.id)}
            onPointerDown={handleArtboardPointerDown(ab)}
            onPointerMove={handleArtboardPointerMove}
            onPointerUp={handleArtboardPointerUp}
            onPointerCancel={handleArtboardPointerUp}
          >
            {ab.layerName && <div className="artboard-label">{ab.layerName}</div>}
            {ab.children?.map((c) => (
              <NodeRenderer key={c.id} node={c} onSelect={handleNodeSelect} />
            ))}
          </div>
        ))}
        {guides.map((g, i) => (
          <div
            key={i}
            className="snap-guide"
            style={
              g.axis === "v"
                ? { left: g.pos, top: -5000, width: 1 / zoom, height: 10000 }
                : { top: g.pos, left: -5000, height: 1 / zoom, width: 10000 }
            }
          />
        ))}
        <SelectionOverlay />
        <CommentPins />
      </div>
      <CanvasToolbar />
      {insertOpen && <InsertPalette onClose={() => setInsertOpen(false)} />}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
