import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useCanvas } from "../store";
import { sendMutation } from "../ws/client";

interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Handle = "e" | "s" | "se";

/**
 * Indigo outline rings around every selected node (primary + shift-click
 * extras). The primary selection also gets resize handles on the east, south,
 * and south-east edges: dragging patches width/height optimistically and
 * commits one update-styles mutation on release.
 */
export function SelectionOverlay() {
  const selectedIds = useCanvas((s) => s.selectedIds);
  const selectedId = useCanvas((s) => s.selectedId);
  const pan = useCanvas((s) => s.pan);
  const zoom = useCanvas((s) => s.zoom);
  const artboards = useCanvas((s) => s.artboards);
  const patchStylesLocal = useCanvas((s) => s.patchStylesLocal);
  const [rects, setRects] = useState<Rect[]>([]);

  const resizeRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    curW: number;
    curH: number;
    moved: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (selectedIds.length === 0) {
      setRects([]);
      return;
    }
    const pannable = document.querySelector(".canvas-pannable") as HTMLElement | null;
    if (!pannable) {
      setRects([]);
      return;
    }
    const p = pannable.getBoundingClientRect();
    const next: Rect[] = [];
    for (const id of selectedIds) {
      const target = document.querySelector(
        `[data-easel-id="${cssEscape(id)}"]`,
      ) as HTMLElement | null;
      if (!target) continue;
      const t = target.getBoundingClientRect();
      next.push({
        id,
        x: (t.left - p.left) / zoom,
        y: (t.top - p.top) / zoom,
        width: t.width / zoom,
        height: t.height / zoom,
      });
    }
    setRects(next);
  }, [selectedIds, pan, zoom, artboards]);

  const primary = rects.find((r) => r.id === selectedId);

  const startResize = (handle: Handle) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!primary) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origW: primary.width,
      origH: primary.height,
      curW: primary.width,
      curH: primary.height,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r || !selectedId) return;
    const dx = (e.clientX - r.startX) / zoom;
    const dy = (e.clientY - r.startY) / zoom;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) r.moved = true;
    if (!r.moved) return;
    const styles: Record<string, string> = {};
    if (r.handle === "e" || r.handle === "se") {
      r.curW = Math.max(8, Math.round(r.origW + dx));
      styles.width = `${r.curW}px`;
    }
    if (r.handle === "s" || r.handle === "se") {
      r.curH = Math.max(8, Math.round(r.origH + dy));
      styles.height = `${r.curH}px`;
    }
    patchStylesLocal([selectedId], styles);
  };

  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    resizeRef.current = null;
    if (!r || !selectedId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!r.moved) return;
    const styles: Record<string, string> = {};
    if (r.handle === "e" || r.handle === "se") styles.width = `${r.curW}px`;
    if (r.handle === "s" || r.handle === "se") styles.height = `${r.curH}px`;
    sendMutation("update-styles", { nodeIds: [selectedId], styles });
  };

  if (rects.length === 0) return null;

  return (
    <>
      {rects.map((rect) => (
        <div
          key={rect.id}
          className="selection-overlay"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {primary &&
        (["e", "s", "se"] as Handle[]).map((h) => (
          <div
            key={h}
            className={`resize-handle resize-handle-${h}`}
            style={handleStyle(h, primary, zoom)}
            onPointerDown={startResize(h)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        ))}
    </>
  );
}

/** Handle hit-areas keep a constant on-screen size regardless of zoom. */
function handleStyle(h: Handle, r: Rect, zoom: number): React.CSSProperties {
  const size = 10 / zoom;
  const half = size / 2;
  const base: React.CSSProperties = { width: size, height: size };
  if (h === "e") {
    return { ...base, left: r.x + r.width - half, top: r.y + r.height / 2 - half, cursor: "ew-resize" };
  }
  if (h === "s") {
    return { ...base, left: r.x + r.width / 2 - half, top: r.y + r.height - half, cursor: "ns-resize" };
  }
  return { ...base, left: r.x + r.width - half, top: r.y + r.height - half, cursor: "nwse-resize" };
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["'\\\]])/g, "\\$1");
}
