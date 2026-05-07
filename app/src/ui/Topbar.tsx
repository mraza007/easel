import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useCanvas } from "../store";
import { ConnectionToggle, ServerMenu } from "./ServerMenu";

export function Topbar() {
  const artboards = useCanvas((s) => s.artboards);
  const documentName = useCanvas((s) => s.documentName);
  const setDocumentName = useCanvas((s) => s.setDocumentName);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Whenever the canvas tree changes, pulse the save indicator briefly.
  useEffect(() => {
    setSaving(true);
    const t = window.setTimeout(() => setSaving(false), 700);
    return () => window.clearTimeout(t);
  }, [artboards, documentName]);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="brand">
          <span className="brand-mark" aria-hidden />
          Easel
        </span>
        <span className="divider-dot">·</span>
        <EditableFileName value={documentName} onCommit={setDocumentName} />
        <span
          className={`save-indicator ${saving ? "saving" : ""}`}
          title={saving ? "Saving…" : "All changes saved"}
        >
          <span className="pulse" />
          {saving ? "Saving" : "Saved"}
        </span>
      </div>
      <div className="topbar-right">
        <div className="server-anchor">
          <ConnectionToggle onClick={() => setMenuOpen((s) => !s)} />
          <ServerMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        </div>
      </div>
    </div>
  );
}

function EditableFileName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

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
    if (next && next !== value) onCommit(next);
    else if (ref.current) ref.current.textContent = value;
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

  const handleBlur = (_e: FocusEvent) => {
    if (editing) commit();
  };

  return (
    <span
      ref={ref}
      className={`file-name${editing ? " editing" : ""}`}
      contentEditable={editing}
      suppressContentEditableWarning
      title="Click to rename"
      onClick={() => !editing && setEditing(true)}
      onBlur={handleBlur}
      onKeyDown={handleKey}
      spellCheck={false}
    >
      {value}
    </span>
  );
}
