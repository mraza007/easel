import { useLayoutEffect, useState } from "react";
import { useCanvas } from "../store";

interface Pin {
  nodeId: string;
  x: number;
  y: number;
  count: number;
  hasAgent: boolean;
}

/**
 * Comment pins: a small badge at the top-right of every node that has
 * unresolved comments. Clicking a pin selects the node, which surfaces the
 * conversation in the inspector's Comments section.
 */
export function CommentPins() {
  const comments = useCanvas((s) => s.comments);
  const artboards = useCanvas((s) => s.artboards);
  const pan = useCanvas((s) => s.pan);
  const zoom = useCanvas((s) => s.zoom);
  const setSelected = useCanvas((s) => s.setSelected);
  const [pins, setPins] = useState<Pin[]>([]);

  useLayoutEffect(() => {
    const open = comments.filter((c) => !c.resolved);
    if (open.length === 0) {
      setPins([]);
      return;
    }
    const pannable = document.querySelector(".canvas-pannable") as HTMLElement | null;
    if (!pannable) return;
    const p = pannable.getBoundingClientRect();
    const byNode = new Map<string, { count: number; hasAgent: boolean }>();
    for (const c of open) {
      const cur = byNode.get(c.nodeId) ?? { count: 0, hasAgent: false };
      byNode.set(c.nodeId, {
        count: cur.count + 1,
        hasAgent: cur.hasAgent || c.author === "agent",
      });
    }
    const next: Pin[] = [];
    for (const [nodeId, info] of byNode) {
      const el = document.querySelector(
        `[data-easel-id="${CSS.escape(nodeId)}"]`,
      ) as HTMLElement | null;
      if (!el) continue;
      const t = el.getBoundingClientRect();
      next.push({
        nodeId,
        x: (t.right - p.left) / zoom,
        y: (t.top - p.top) / zoom,
        count: info.count,
        hasAgent: info.hasAgent,
      });
    }
    setPins(next);
  }, [comments, artboards, pan, zoom]);

  if (pins.length === 0) return null;

  return (
    <>
      {pins.map((pin) => (
        <button
          key={pin.nodeId}
          className={`comment-pin${pin.hasAgent ? " from-agent" : ""}`}
          style={{
            left: pin.x - 8 / zoom,
            top: pin.y - 8 / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "top left",
          }}
          title={`${pin.count} comment${pin.count > 1 ? "s" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setSelected(pin.nodeId);
          }}
        >
          {pin.count}
        </button>
      ))}
    </>
  );
}
