import { useLayoutEffect, useState } from "react";
import { useCanvas } from "../store";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renders an indigo outline ring around the selected node. Sits inside the
 * canvas-pannable container so it pans/zooms with the world. Recomputes the
 * rect whenever selection, pan, zoom, or the tree changes.
 */
export function SelectionOverlay() {
  const selectedId = useCanvas((s) => s.selectedId);
  const pan = useCanvas((s) => s.pan);
  const zoom = useCanvas((s) => s.zoom);
  const artboards = useCanvas((s) => s.artboards);
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!selectedId) {
      setRect(null);
      return;
    }
    const target = document.querySelector(
      `[data-easel-id="${cssEscape(selectedId)}"]`,
    ) as HTMLElement | null;
    const pannable = document.querySelector(".canvas-pannable") as HTMLElement | null;
    if (!target || !pannable) {
      setRect(null);
      return;
    }
    const t = target.getBoundingClientRect();
    const p = pannable.getBoundingClientRect();
    setRect({
      x: (t.left - p.left) / zoom,
      y: (t.top - p.top) / zoom,
      width: t.width / zoom,
      height: t.height / zoom,
    });
  }, [selectedId, pan, zoom, artboards]);

  if (!rect) return null;

  return (
    <div
      className="selection-overlay"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["'\\\]])/g, "\\$1");
}
