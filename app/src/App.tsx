import { useEffect, useRef } from "react";
import { Topbar } from "./ui/Topbar";
import { Sidebar } from "./ui/Sidebar";
import { Canvas } from "./canvas/Canvas";
import { useCanvas } from "./store";
import { connectMcp, sendMutation } from "./ws/client";

export function App() {
  const artboards = useCanvas((s) => s.artboards);
  const setPan = useCanvas((s) => s.setPan);
  const setZoom = useCanvas((s) => s.setZoom);
  const fitDoneRef = useRef(false);

  useEffect(() => {
    const dispose = connectMcp();
    return dispose;
  }, []);

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

      const { selectedId, setSelected } = useCanvas.getState();

      if (e.key === "Escape") {
        if (selectedId) setSelected(null);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedId) return;
        e.preventDefault();
        sendMutation("delete-node", { nodeId: selectedId });
        setSelected(null);
        return;
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
      </div>
    </div>
  );
}
