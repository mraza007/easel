import { useEffect, useRef } from "react";
import { useCanvas } from "../store";
import { reconnectMcp, sendMutation } from "../ws/client";
import {
  ChevronExpandIcon,
  PlugIcon,
  RefreshIcon,
  TrashIcon,
} from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Popover anchored to the connection pill. Shows server diagnostics and
 * exposes three actions: reload from disk, reconnect WS, reset canvas.
 *
 * Closes on outside click, Escape, or after a destructive action.
 */
export function ServerMenu({ open, onClose }: Props) {
  const connection = useCanvas((s) => s.connection);
  const info = useCanvas((s) => s.serverInfo);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      // Also leave the connection-pill click alone — it's the toggle.
      const pill = (e.target as HTMLElement)?.closest(".connection-pill");
      if (pill) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleReload = () => {
    sendMutation("reload-state", {});
    onClose();
  };

  const handleReconnect = () => {
    reconnectMcp();
    onClose();
  };

  const handleReset = () => {
    if (
      window.confirm(
        "Reset the canvas? This removes every artboard from the current document.",
      )
    ) {
      sendMutation("reset-canvas", {});
      onClose();
    }
  };

  return (
    <div ref={ref} className="server-menu" role="menu">
      <header className="server-menu-header">
        <span>Server</span>
        <span className={`status-dot ${connection}`} />
      </header>

      <div className="server-menu-body">
        <InfoRow label="Status" value={statusText(connection)} />
        <InfoRow label="PID" value={info ? String(info.pid) : "—"} mono />
        <InfoRow
          label="Uptime"
          value={info ? formatUptime(Date.now() - info.startedAt) : "—"}
        />
        <InfoRow label="Version" value={info ? info.version : "—"} mono />
        <InfoRow
          label="State file"
          value={info ? squashHome(info.statePath) : "—"}
          mono
          truncate
        />
        <InfoRow
          label="Last saved"
          value={info?.stateMtime ? formatRelative(info.stateMtime) : "—"}
        />
      </div>

      <div className="server-menu-actions">
        <button className="server-menu-btn" onClick={handleReload} role="menuitem">
          <RefreshIcon />
          <span>
            <strong>Reload from disk</strong>
            <em>Re-read state.json (use if disk and canvas got out of sync)</em>
          </span>
        </button>
        <button className="server-menu-btn" onClick={handleReconnect} role="menuitem">
          <PlugIcon />
          <span>
            <strong>Reconnect</strong>
            <em>Close and reopen the WebSocket</em>
          </span>
        </button>
        <button
          className="server-menu-btn danger"
          onClick={handleReset}
          role="menuitem"
        >
          <TrashIcon />
          <span>
            <strong>Reset canvas</strong>
            <em>Remove every artboard. Confirms first.</em>
          </span>
        </button>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="server-menu-row">
      <span className="server-menu-label">{label}</span>
      <span
        className={`server-menu-value${mono ? " mono" : ""}${truncate ? " truncate" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function statusText(c: string): string {
  return c === "connected" ? "Connected" : c === "connecting" ? "Connecting" : "Offline";
}

function squashHome(p: string): string {
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
    // We don't know the exact home dir from the browser; Easel runs as a single
    // user locally, so a heuristic on the leading prefix is enough.
    return p.replace(/^\/(?:home|Users)\/[^/]+/, "~");
  }
  return p;
}

function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export function ConnectionToggle({
  onClick,
}: {
  onClick: () => void;
}) {
  const connection = useCanvas((s) => s.connection);
  const label = statusText(connection);
  return (
    <button
      type="button"
      className="connection-pill"
      onClick={onClick}
      title="Server menu"
    >
      <span className={`status-dot ${connection}`} />
      <span>{label}</span>
      <ChevronExpandIcon style={{ marginLeft: 2, opacity: 0.5 }} />
    </button>
  );
}
