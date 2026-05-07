import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { PaperNode } from "../types";
import { sendMutation } from "../ws/client";

interface Props {
  node: PaperNode;
  onSelect: (id: string) => void;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Recursively render a PaperNode tree as real DOM elements.
 * Styles map straight through; this is the property that makes export lossless.
 *
 * Text leaves (nodes with `text` and no children) become editable on
 * double-click via contentEditable. Edits are committed on blur or Enter.
 */
export function NodeRenderer({ node, onSelect }: Props) {
  const [editing, setEditing] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const isEditableLeaf =
    node.text !== undefined && (!node.children || node.children.length === 0);

  // When entering edit mode, focus the element and select all its text.
  useEffect(() => {
    if (!editing || !elRef.current) return;
    const el = elRef.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const handleClick = (e: MouseEvent) => {
    if (editing) return;
    e.stopPropagation();
    onSelect(node.id);
  };

  const handleDoubleClick = (e: MouseEvent) => {
    if (!isEditableLeaf) return;
    e.stopPropagation();
    e.preventDefault();
    setEditing(true);
  };

  const commit = () => {
    if (!elRef.current) return;
    const newText = elRef.current.textContent ?? "";
    if (newText !== node.text) {
      sendMutation("set-text", { nodeId: node.id, text: newText });
    }
    setEditing(false);
  };

  const handleBlur = (_e: FocusEvent) => {
    if (editing) commit();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!editing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      elRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Restore original text and exit without saving.
      if (elRef.current && node.text !== undefined) {
        elRef.current.textContent = node.text;
      }
      setEditing(false);
    }
  };

  const style = node.styles as CSSProperties | undefined;
  const props: Record<string, unknown> = {
    style,
    "data-easel-id": node.id,
    onClick: handleClick,
    ref: (el: HTMLElement | null) => {
      elRef.current = el;
    },
    ...(node.attrs ?? {}),
  };

  if (isEditableLeaf) {
    props.onDoubleClick = handleDoubleClick;
    if (editing) {
      props.contentEditable = "true";
      props.suppressContentEditableWarning = true;
      props.onBlur = handleBlur;
      props.onKeyDown = handleKeyDown;
      // Don't bubble drag/click to canvas while editing.
      props.onPointerDown = (e: MouseEvent) => e.stopPropagation();
    }
  }

  if (VOID_TAGS.has(node.tag)) {
    return createElement(node.tag, props);
  }

  const children: React.ReactNode[] = [];
  if (node.text !== undefined) children.push(node.text);
  if (node.children) {
    for (const child of node.children) {
      children.push(<NodeRenderer key={child.id} node={child} onSelect={onSelect} />);
    }
  }

  return createElement(node.tag, props, ...children);
}
