import { useState } from "react";
import { useCanvas } from "../store";

/**
 * Sidebar section rendering the scanned design system: tokens (with color
 * swatches; click copies `var(--name)`) and components with their variants.
 */
export function DesignSystemSection() {
  const ds = useCanvas((s) => s.designSystem);
  const [copied, setCopied] = useState<string | null>(null);

  if (!ds || Object.keys(ds.customProperties).length + ds.components.length === 0) {
    return (
      <section className="sidebar-section">
        <header className="section-header">
          <span>Design system</span>
          <span className="count">scan</span>
        </header>
        <div className="empty-state">
          <strong>Nothing detected yet</strong>
          Run the MCP server inside a project (or set{" "}
          <code>EASEL_PROJECT_ROOT</code>) to see its tokens and components here.
        </div>
      </section>
    );
  }

  const tokens = Object.entries(ds.customProperties);

  const copyToken = (name: string) => {
    void navigator.clipboard.writeText(`var(--${name})`);
    setCopied(name);
    window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
  };

  return (
    <section className="sidebar-section">
      <header className="section-header">
        <span>Design system</span>
        <span className="count">
          {tokens.length} tokens · {ds.components.length} components
        </span>
      </header>
      <div className="token-list">
        {tokens.map(([name, value]) => (
          <button
            key={name}
            className="token-row"
            title={`--${name}: ${value} — click to copy var(--${name})`}
            onClick={() => copyToken(name)}
          >
            {isColor(value) && (
              <span className="token-swatch" style={{ background: value }} />
            )}
            <span className="token-name">--{name}</span>
            <span className="token-value">{copied === name ? "copied" : value}</span>
          </button>
        ))}
        {ds.components.map((c) => (
          <div
            key={c.filePath}
            className="token-row"
            title={`${c.filePath}${c.props ? `\nprops: ${c.props.join(", ")}` : ""}`}
          >
            <span className="token-name">&lt;{c.name}&gt;</span>
            <span className="token-value">
              {c.variants ? Object.keys(c.variants).join(" ") : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function isColor(value: string): boolean {
  const v = value.trim();
  return (
    /^#([0-9a-f]{3,8})$/i.test(v) ||
    /^(rgb|hsl|oklch|oklab|color)\(/i.test(v) ||
    /^(var\(--)/.test(v) === false && /^[a-z]+$/i.test(v) && CSS.supports("color", v)
  );
}
