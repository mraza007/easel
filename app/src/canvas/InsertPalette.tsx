import { useEffect, useRef } from "react";
import { findNode, useCanvas } from "../store";
import { sendMutation } from "../ws/client";

interface Insertable {
  label: string;
  hint: string;
  html: string;
}

const INSERTABLES: Insertable[] = [
  {
    label: "Text",
    hint: "paragraph",
    html: `<p style="font-size: 14px; line-height: 1.6; color: #444444">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`,
  },
  {
    label: "Heading",
    hint: "h2",
    html: `<h2 style="font-size: 28px; font-weight: 700; color: #111111; margin: 0">Heading</h2>`,
  },
  {
    label: "Button",
    hint: "button",
    html: `<button style="padding: 10px 20px; border-radius: 8px; background: #111111; color: #ffffff; font-size: 14px; font-weight: 500; border: none">Button</button>`,
  },
  {
    label: "Image",
    hint: "img placeholder",
    html: `<img alt="placeholder" style="width: 320px; height: 180px; border-radius: 8px; background: #e5e5e5; object-fit: cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23e5e5e5'/%3E%3C/svg%3E" />`,
  },
  {
    label: "Stack",
    hint: "flex column",
    html: `<div layer-name="Stack" style="display: flex; flex-direction: column; gap: 12px; padding: 16px"></div>`,
  },
  {
    label: "Row",
    hint: "flex row",
    html: `<div layer-name="Row" style="display: flex; align-items: center; gap: 12px"></div>`,
  },
  {
    label: "Card",
    hint: "surface",
    html: `<div layer-name="Card" style="display: flex; flex-direction: column; gap: 8px; padding: 20px; border-radius: 12px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1)"></div>`,
  },
];

interface Props {
  onClose: () => void;
}

/**
 * Quick-insert palette (toggled with `I` or the toolbar +). Inserts into the
 * selected node if it can hold children, else its artboard, else the first
 * artboard on the canvas.
 */
export function InsertPalette({ onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const insert = (item: Insertable) => {
    const target = pickTarget();
    if (!target) return;
    sendMutation("insert-html", { targetNodeId: target, html: item.html });
    onClose();
  };

  return (
    <div className="insert-palette" ref={ref}>
      <div className="insert-palette-title">Insert</div>
      {INSERTABLES.map((item) => (
        <button key={item.label} className="insert-item" onClick={() => insert(item)}>
          <span>{item.label}</span>
          <span className="insert-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** Selected container → selected node's nearest container → first artboard. */
function pickTarget(): string | null {
  const { artboards, selectedId } = useCanvas.getState();
  const node = findNode(artboards, selectedId);
  if (node) {
    // Text leaves can't hold children; fall back to their artboard.
    const isLeaf = node.text !== undefined && (node.children?.length ?? 0) === 0;
    if (!isLeaf) return node.id;
    const owner = artboards.find((a) => findNode([a], node.id));
    if (owner) return owner.id;
  }
  return artboards[0]?.id ?? null;
}
