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
    setSelected(id);
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
          >
            {ab.layerName && <div className="artboard-label">{ab.layerName}</div>}
            {ab.children?.map((c) => (
              <NodeRenderer key={c.id} node={c} onSelect={setSelected} />
            ))}
          </div>
        ))}
        <SelectionOverlay />
      </div>
      <CanvasToolbar />
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
