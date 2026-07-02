import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PaperNode } from "../types";
import { useCanvas } from "../store";
import { requestBundle } from "../ws/client";

interface Props {
  node: PaperNode;
  onSelect: (id: string, additive: boolean) => void;
}

/**
 * Renders a `component` node: the project's real component, bundled by the
 * MCP server from the project's own source + node_modules, executed inside a
 * sandboxed iframe (allow-scripts only, no same-origin). The design-system
 * custom properties are injected so var(--token) styles resolve inside too.
 */
export function ComponentFrame({ node, onSelect }: Props) {
  const designSystem = useCanvas((s) => s.designSystem);
  const [bundle, setBundle] = useState<{ js?: string; error?: string } | null>(null);

  const name = node.attrs?.component ?? "?";
  const propsJson = node.attrs?.props ?? "{}";

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(propsJson) as Record<string, unknown>;
    } catch {
      // Bad props JSON — bundle with none; the chip will still render.
    }
    void requestBundle(name, props).then((r) => {
      if (!cancelled) setBundle(r.ok ? { js: r.js } : { error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [name, propsJson]);

  const srcDoc = useMemo(() => {
    if (!bundle?.js) return null;
    const tokens = designSystem?.customProperties ?? {};
    const rootVars = Object.entries(tokens)
      .map(([k, v]) => `--${k}: ${v};`)
      .join(" ");
    return `<!doctype html><html><head><style>
      html, body { margin: 0; padding: 0; background: transparent; }
      :root { ${rootVars} }
    </style></head><body><div id="root"></div><script>${bundle.js}</script></body></html>`;
  }, [bundle, designSystem]);

  const style = (node.styles ?? {}) as CSSProperties;

  return (
    <div
      className="component-frame"
      style={style}
      data-easel-id={node.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id, e.shiftKey);
      }}
    >
      <div className="component-frame-badge">{name}</div>
      {srcDoc ? (
        <iframe
          title={name}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: "100%", height: "100%", border: 0, pointerEvents: "none" }}
        />
      ) : (
        <div className="component-frame-fallback">
          {bundle?.error ? `⚠ ${bundle.error}` : "bundling…"}
        </div>
      )}
    </div>
  );
}
