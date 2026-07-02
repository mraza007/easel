import { createHash } from "node:crypto";
import path from "node:path";
import type { ComponentEntry } from "@easel/ds-scanner";

export interface BundleResult {
  ok: boolean;
  js?: string;
  error?: string;
}

const cache = new Map<string, BundleResult>();

/**
 * Bundle one of the user's real components into a self-contained IIFE that
 * renders it (with the given props) into #root. React and everything else
 * resolves from the user's own node_modules, so what renders is what ships.
 *
 * v1 limitations, by design:
 * - CSS imports are stubbed out; Tailwind utilities inside the component
 *   won't be styled unless the project's compiled CSS is injected separately.
 * - React components only.
 */
export async function bundleComponent(
  projectRoot: string,
  entry: ComponentEntry,
  props: Record<string, unknown>,
): Promise<BundleResult> {
  const key = createHash("sha1")
    .update(entry.filePath)
    .update(JSON.stringify(props))
    .digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  let esbuild: typeof import("esbuild");
  try {
    esbuild = await import("esbuild");
  } catch {
    return fail(key, "esbuild is not installed in the Easel MCP server");
  }

  const importName = entry.exportType === "default" ? "default" : entry.name;
  const wrapper = `
    import { createElement } from "react";
    import { createRoot } from "react-dom/client";
    import * as Mod from ${JSON.stringify(entry.filePath)};
    const C = Mod[${JSON.stringify(importName)}] ?? Mod.default ?? Mod[${JSON.stringify(entry.name)}];
    const props = ${JSON.stringify(props)};
    if (!C) {
      document.getElementById("root").textContent = "export not found: ${entry.name}";
    } else {
      createRoot(document.getElementById("root")).render(createElement(C, props));
    }
  `;

  try {
    const result = await esbuild.build({
      stdin: {
        contents: wrapper,
        resolveDir: path.dirname(entry.filePath),
        loader: "tsx",
      },
      absWorkingDir: projectRoot,
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl" },
      logLevel: "silent",
    });
    const js = result.outputFiles?.[0]?.text;
    if (!js) return fail(key, "esbuild produced no output");
    const ok: BundleResult = { ok: true, js };
    cache.set(key, ok);
    return ok;
  } catch (err) {
    return fail(key, err instanceof Error ? err.message : String(err));
  }
}

function fail(key: string, error: string): BundleResult {
  const r: BundleResult = { ok: false, error };
  cache.set(key, r);
  return r;
}
