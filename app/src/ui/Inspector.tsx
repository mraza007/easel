import { useEffect, useState, type KeyboardEvent } from "react";
import { findNode, useCanvas } from "../store";
import { sendMutation } from "../ws/client";

/**
 * Right-hand style inspector. Edits the primary selection's styles; when
 * multiple nodes are selected, commits apply to all of them. Fields commit on
 * blur or Enter as a single update-styles mutation (one undo entry).
 */
export function Inspector() {
  const selectedId = useCanvas((s) => s.selectedId);
  const selectedIds = useCanvas((s) => s.selectedIds);
  const artboards = useCanvas((s) => s.artboards);

  const node = findNode(artboards, selectedId);

  if (!node) {
    return (
      <aside className="inspector">
        <div className="inspector-empty">
          Select an element on the canvas to edit its styles.
        </div>
      </aside>
    );
  }

  const commit = (prop: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendMutation("update-styles", {
      nodeIds: selectedIds,
      styles: { [prop]: trimmed },
    });
  };

  const s = node.styles ?? {};
  const multi = selectedIds.length > 1;

  return (
    <aside className="inspector">
      <div className="inspector-target">
        {multi ? `${selectedIds.length} selected` : `${node.id} <${node.tag}>`}
      </div>

      <Section title="Layout">
        <Field label="W" prop="width" value={s.width} onCommit={commit} />
        <Field label="H" prop="height" value={s.height} onCommit={commit} />
        <Field label="Display" prop="display" value={s.display} onCommit={commit} />
        <Field label="Direction" prop="flexDirection" value={s.flexDirection} onCommit={commit} />
        <Field label="Align" prop="alignItems" value={s.alignItems} onCommit={commit} />
        <Field label="Justify" prop="justifyContent" value={s.justifyContent} onCommit={commit} />
        <Field label="Gap" prop="gap" value={s.gap} onCommit={commit} />
      </Section>

      <Section title="Spacing">
        <Field label="Padding" prop="padding" value={s.padding} onCommit={commit} wide />
        <Field label="Margin" prop="margin" value={s.margin} onCommit={commit} wide />
      </Section>

      <Section title="Fill & border">
        <Field label="Background" prop="background" value={s.background} onCommit={commit} wide />
        <Field label="Border" prop="border" value={s.border} onCommit={commit} wide />
        <Field label="Radius" prop="borderRadius" value={s.borderRadius} onCommit={commit} />
        <Field label="Shadow" prop="boxShadow" value={s.boxShadow} onCommit={commit} />
      </Section>

      <Section title="Text">
        <Field label="Color" prop="color" value={s.color} onCommit={commit} />
        <Field label="Size" prop="fontSize" value={s.fontSize} onCommit={commit} />
        <Field label="Weight" prop="fontWeight" value={s.fontWeight} onCommit={commit} />
        <Field label="Align" prop="textAlign" value={s.textAlign} onCommit={commit} />
      </Section>

      <Comments nodeId={node.id} />
    </aside>
  );
}

function Comments({ nodeId }: { nodeId: string }) {
  const comments = useCanvas((s) => s.comments).filter(
    (c) => c.nodeId === nodeId && !c.resolved,
  );
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    sendMutation("add-comment", { nodeId, text });
    setDraft("");
  };

  return (
    <section className="inspector-section">
      <header className="section-header">
        <span>Comments</span>
        {comments.length > 0 && <span className="count">{comments.length}</span>}
      </header>
      <div className="comment-list">
        {comments.map((c) => (
          <div key={c.id} className={`comment ${c.author}`}>
            <div className="comment-meta">
              <span className="comment-author">{c.author}</span>
              <button
                className="comment-resolve"
                title="Resolve"
                onClick={() => sendMutation("resolve-comment", { id: c.id })}
              >
                ✓
              </button>
            </div>
            <div className="comment-text">{c.text}</div>
          </div>
        ))}
        <input
          className="comment-input"
          value={draft}
          placeholder="Reply or note…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <header className="section-header">
        <span>{title}</span>
      </header>
      <div className="inspector-grid">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  prop: string;
  value: string | number | undefined;
  onCommit: (prop: string, value: string) => void;
  wide?: boolean;
}

/**
 * Uncontrolled-ish input: local draft state re-seeded whenever the node's
 * style value changes (e.g. an agent edit lands while the panel is open).
 */
function Field({ label, prop, value, onCommit, wide }: FieldProps) {
  const external = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(external);

  useEffect(() => setDraft(external), [external]);

  const commit = () => {
    if (draft !== external && draft.trim() !== "") onCommit(prop, draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") {
      setDraft(external);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className={wide ? "inspector-field wide" : "inspector-field"}>
      <label>{label}</label>
      <input
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </div>
  );
}
