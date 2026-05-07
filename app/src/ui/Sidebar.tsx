import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useCanvas } from "../store";
import type { PaperNode } from "../types";
import { ChevronDownIcon, iconForTag, PlusIcon } from "./icons";
import { sendMutation } from "../ws/client";

export function Sidebar() {
  const artboards = useCanvas((s) => s.artboards);

  const totalNodes = artboards.reduce((acc, a) => acc + 1 + countNodes(a), 0);

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <header className="section-header">
          <span>Artboards</span>
          <span className="header-actions">
            <span className="count">{totalNodes}</span>
            <button
              className="header-icon-btn"
              title="New artboard"
              onClick={() => sendMutation("create-artboard", {})}
            >
              <PlusIcon />
            </button>
          </span>
        </header>
        <div className="section-body">
          {artboards.length === 0 ? (
            <div className="empty-state">
              <strong>Empty canvas</strong>
              Click the <code>+</code> above, or ask your IDE agent to call{" "}
              <code>create_artboard</code>.
            </div>
          ) : (
            artboards.map((ab) => <Layer key={ab.id} node={ab} depth={0} isArtboard />)
          )}
        </div>
      </section>

      <section className="sidebar-section">
        <header className="section-header">
          <span>Design system</span>
          <span className="count">scan</span>
        </header>
        <div className="empty-state">
          <strong>Auto-detected from project root</strong>
          Tokens and components from your repo will land here once Easel is run
          inside a project. Set <code>EASEL_PROJECT_ROOT</code> to point at one.
        </div>
      </section>
    </aside>
  );
}

interface LayerProps {
  node: PaperNode;
  depth: number;
  isArtboard?: boolean;
}

function Layer({ node, depth, isArtboard = false }: LayerProps) {
  const selectedId = useCanvas((s) => s.selectedId);
  const setSelected = useCanvas((s) => s.setSelected);
  const Icon = iconForTag(node.tag);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const label = node.layerName ?? node.tag;
  const showTagAside = !node.layerName && node.tag !== "artboard";
  const isSelected = selectedId === node.id;

  return (
    <>
      <div
        className={`layer-row${isArtboard ? " is-artboard" : ""}${isSelected ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.id}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(node.id);
        }}
      >
        <span className="layer-chevron" aria-hidden>
          {hasChildren && <ChevronDownIcon />}
        </span>
        <span className="layer-icon">
          <Icon />
        </span>
        {isArtboard ? (
          <EditableLayerName node={node} fallback={label} />
        ) : (
          <span className="layer-name">
            {label}
            {showTagAside && node.layerName && <span className="tag">{node.tag}</span>}
          </span>
        )}
      </div>
      {node.children?.map((c) => (
        <Layer key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

function EditableLayerName({ node, fallback }: { node: PaperNode; fallback: string }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const value = node.layerName ?? fallback;

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const commit = () => {
    const next = (ref.current?.textContent ?? "").trim();
    setEditing(false);
    if (next && next !== value) {
      sendMutation("set-layer-name", { nodeId: node.id, layerName: next });
    } else if (ref.current) {
      ref.current.textContent = value;
    }
  };

  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  };

  const handleBlur = (_e: FocusEvent) => {
    if (editing) commit();
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (ref.current) ref.current.textContent = value;
      setEditing(false);
    }
  };

  return (
    <span
      ref={ref}
      className={`layer-name${editing ? " editing" : ""}`}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      onKeyDown={handleKey}
      spellCheck={false}
    >
      {value}
    </span>
  );
}

function countNodes(node: PaperNode): number {
  if (!node.children) return 0;
  let n = node.children.length;
  for (const c of node.children) n += countNodes(c);
  return n;
}
