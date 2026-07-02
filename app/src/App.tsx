import { useEffect, useRef } from "react";
import { Topbar } from "./ui/Topbar";
import { Sidebar } from "./ui/Sidebar";
import { Inspector } from "./ui/Inspector";
import { Canvas } from "./canvas/Canvas";
import { useCanvas } from "./store";
import { connectMcp, sendMutation } from "./ws/client";
import { fitView } from "./canvas/fitView";

export function App() {
  const artboards = useCanvas((s) => s.artboards);
  const designSystem = useCanvas((s) => s.designSystem);
  const setPan = useCanvas((s) => s.setPan);
  const setZoom = useCanvas((s) => s.setZoom);
  const fitDoneRef = useRef(false);

  useEffect(() => {
    const dispose = connectMcp();
    return dispose;
  }, []);

  // Inject the project's CSS custom properties into :root so designs using
  // var(--token) — via apply_token or agent-authored HTML — actually resolve.
  useEffect(() => {
    const props = designSystem?.customProperties;
    if (!props || Object.keys(props).length === 0) return;
    const style = document.createElement("style");
    style.setAttribute("data-easel-tokens", "");
    const decls = Object.entries(props)
      .map(([k, v]) => `--${k}: ${v};`)
      .join("\n  ");
    style.textContent = `:root {\n  ${decls}\n}`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [designSystem]);

  // Auto-fit-to-view once we have artboards and the layout has settled.
  useEffect(() => {
    if (fitDoneRef.current) return;
    if (artboards.length === 0) return;
    const host = document.querySelector(".canvas-host") as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const PADDING = 80;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const a of artboards) {
      const w = parseFloat(String(a.styles?.width ?? "1200")) || 1200;
      const h = parseFloat(String(a.styles?.height ?? "720")) || 720;
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x + w);
      maxY = Math.max(maxY, a.y + h);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const target = Math.max(
      0.1,
      Math.min(
        4,
        Math.min(
          (rect.width - PADDING * 2) / contentW,
          (rect.height - PADDING * 2) / contentH,
        ),
      ),
    );
    setZoom(target);
    setPan({
      x: (rect.width - contentW * target) / 2 - minX * target,
      y: (rect.height - contentH * target) / 2 - minY * target,
    });
    fitDoneRef.current = true;
  }, [artboards, setPan, setZoom]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't intercept while the user is typing somewhere.
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const { selectedId, selectedIds, setSelected } = useCanvas.getState();

      if (e.key === "Escape") {
        if (selectedId) setSelected(null);
        return;
      }

      // Cmd/Ctrl + Z: undo. With Shift: redo.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        sendMutation(e.shiftKey ? "redo" : "undo", {});
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        for (const id of selectedIds) {
          sendMutation("delete-node", { nodeId: id });
        }
        setSelected(null);
        return;
      }

      // I: toggle the insert palette.
      if (e.key.toLowerCase() === "i" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const { insertOpen, setInsertOpen } = useCanvas.getState();
        setInsertOpen(!insertOpen);
        return;
      }

      // Shift+1: fit all artboards. Shift+2: fit selection.
      if (e.shiftKey && (e.key === "1" || e.key === "2" || e.key === "!" || e.key === "@")) {
        e.preventDefault();
        fitView(e.key === "2" || e.key === "@" ? selectedId : null);
        return;
      }

      // Arrow keys: nudge the selected artboard (Shift = 10px).
      if (e.key.startsWith("Arrow") && selectedId) {
        const ab = useCanvas.getState().artboards.find((a) => a.id === selectedId);
        if (ab) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          sendMutation("move-artboard", { nodeId: ab.id, x: ab.x + dx, y: ab.y + dy });
          return;
        }
      }

      // Cmd/Ctrl + D: duplicate selected artboard.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (!selectedId) return;
        // Only artboards (top-level frames) duplicate via this shortcut for now.
        const isArtboard = useCanvas
          .getState()
          .artboards.some((a) => a.id === selectedId);
        if (!isArtboard) return;
        e.preventDefault();
        sendMutation("duplicate-artboard", { nodeId: selectedId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <Sidebar />
        <Canvas />
        <Inspector />
      </div>
    </div>
  );
}
