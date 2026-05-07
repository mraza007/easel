import type { Artboard } from "./types.js";

/**
 * Pre-alpha seed: gives a fresh Easel instance something to look at before any
 * agent has touched it. Replace with empty array once Easel is in regular use.
 */
export const SEED_ARTBOARDS: Artboard[] = [
  {
    id: "ab-hero",
    tag: "artboard",
    layerName: "Hero / Desktop",
    x: 80,
    y: 80,
    styles: { width: "1200px", height: "720px", padding: "96px 80px" },
    children: [
      {
        id: "hero-eyebrow",
        tag: "div",
        styles: {
          fontSize: "13px",
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#6366f1",
          marginBottom: "24px",
        },
        text: "Easel · Sample artboard",
      },
      {
        id: "hero-headline",
        tag: "h1",
        styles: {
          fontSize: "72px",
          lineHeight: "1.04",
          letterSpacing: "-0.03em",
          fontWeight: 600,
          color: "#0a0a0a",
          maxWidth: "880px",
          margin: 0,
        },
        text: "Design with your real components, ship without the round-trip.",
      },
      {
        id: "hero-sub",
        tag: "p",
        styles: {
          fontSize: "20px",
          lineHeight: "1.5",
          color: "#525252",
          maxWidth: "640px",
          marginTop: "24px",
        },
        text: "Easel reads your Tailwind config and component library, lets your IDE agent compose UI live, then translates the canvas to idiomatic JSX.",
      },
      {
        id: "hero-actions",
        tag: "div",
        styles: { display: "flex", gap: "12px", marginTop: "40px" },
        children: [
          {
            id: "btn-primary",
            tag: "button",
            styles: {
              padding: "14px 22px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "10px",
              background: "#0a0a0a",
              color: "#fff",
              border: 0,
            },
            text: "Get started",
          },
          {
            id: "btn-secondary",
            tag: "button",
            styles: {
              padding: "14px 22px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "10px",
              background: "#fff",
              color: "#0a0a0a",
              border: "1px solid #e5e5e5",
            },
            text: "Read the docs",
          },
        ],
      },
    ],
  },
];
