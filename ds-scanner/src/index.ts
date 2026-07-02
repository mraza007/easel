import { promises as fs } from "node:fs";
import path from "node:path";

export interface DesignSystem {
  projectRoot: string;
  framework: "react" | "vue" | "svelte" | "unknown";
  styling: {
    tailwindConfigPath: string | null;
    cssEntryPaths: string[];
    customProperties: Record<string, string>;
  };
  components: ComponentEntry[];
  packageJson: {
    name?: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}

export interface ComponentEntry {
  name: string;
  filePath: string;
  exportType: "default" | "named" | "unknown";
  /** Prop names extracted from `interface XxxProps` / `type XxxProps = {...}`. */
  props?: string[];
  /** cva()/tv() variant groups: { variant: ["default","destructive"], size: [...] }. */
  variants?: Record<string, string[]>;
  summary?: string;
}

const TAILWIND_CONFIG_NAMES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.cjs",
];

const COMPONENT_DIRS = [
  "src/components/ui",
  "src/components",
  "components/ui",
  "components",
  "app/components",
];

const COMPONENT_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte"]);

/** Directories worth walking for stylesheets; keeps the scan off vendor code. */
const CSS_SCAN_DIRS = ["src", "app", "styles", "css"];
const CSS_FILE_LIMIT = 40;

export async function scanProject(projectRoot: string): Promise<DesignSystem> {
  const root = path.resolve(projectRoot);
  const [packageJson, tailwindConfigPath, cssEntryPaths, components] =
    await Promise.all([
      readPackageJson(root),
      findFirstExisting(root, TAILWIND_CONFIG_NAMES),
      findCssFiles(root),
      findComponents(root),
    ]);

  const customProperties = await collectCustomProperties(cssEntryPaths);
  const framework = detectFramework(packageJson);

  return {
    projectRoot: root,
    framework,
    styling: {
      tailwindConfigPath,
      cssEntryPaths,
      customProperties,
    },
    components,
    packageJson,
  };
}

async function readPackageJson(root: string): Promise<DesignSystem["packageJson"]> {
  const raw = await safeReadFile(path.join(root, "package.json"));
  if (!raw) return { dependencies: {}, devDependencies: {} };
  try {
    const json = JSON.parse(raw);
    return {
      name: typeof json.name === "string" ? json.name : undefined,
      dependencies: json.dependencies ?? {},
      devDependencies: json.devDependencies ?? {},
    };
  } catch {
    return { dependencies: {}, devDependencies: {} };
  }
}

function detectFramework(pkg: DesignSystem["packageJson"]): DesignSystem["framework"] {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  if (all["react"] || all["next"]) return "react";
  if (all["vue"] || all["nuxt"]) return "vue";
  if (all["svelte"] || all["@sveltejs/kit"]) return "svelte";
  return "unknown";
}

async function findFirstExisting(
  root: string,
  candidates: string[],
): Promise<string | null> {
  for (const name of candidates) {
    const full = path.join(root, name);
    if (await exists(full)) return full;
  }
  return null;
}

/**
 * Walk src/app/styles/css for stylesheets (capped) so Tailwind v4 `@theme`
 * blocks and token files outside the classic globals.css locations are found.
 */
async function findCssFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const rel of CSS_SCAN_DIRS) {
    const dir = path.join(root, rel);
    if (!(await exists(dir))) continue;
    await walk(dir, async (file) => {
      if (out.length >= CSS_FILE_LIMIT) return;
      if (path.extname(file) === ".css") out.push(file);
    });
    if (out.length >= CSS_FILE_LIMIT) break;
  }
  return out.sort();
}

async function findComponents(root: string): Promise<ComponentEntry[]> {
  const seen = new Set<string>();
  const out: ComponentEntry[] = [];
  for (const rel of COMPONENT_DIRS) {
    const dir = path.join(root, rel);
    if (!(await exists(dir))) continue;
    await walk(dir, async (file) => {
      const ext = path.extname(file);
      if (!COMPONENT_EXTS.has(ext)) return;
      const name = path.basename(file, ext);
      if (seen.has(file)) return;
      seen.add(file);
      const src = await safeReadFile(file);
      const exportType = guessExportTypeFrom(src);
      const props = src ? extractProps(src) : undefined;
      const variants = src ? extractVariants(src) : undefined;
      out.push({
        name,
        filePath: file,
        exportType,
        ...(props && props.length > 0 ? { props } : {}),
        ...(variants && Object.keys(variants).length > 0 ? { variants } : {}),
      });
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function walk(
  dir: string,
  visit: (file: string) => Promise<void>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) return;
        return walk(full, visit);
      }
      if (entry.isFile()) await visit(full);
    }),
  );
}

function guessExportTypeFrom(src: string | null): ComponentEntry["exportType"] {
  if (!src) return "unknown";
  if (/export\s+default\b/.test(src)) return "default";
  if (/export\s+(?:const|function|class)\s+[A-Z]/.test(src)) return "named";
  return "unknown";
}

/**
 * Best-effort prop extraction: field names from the first
 * `interface XxxProps { ... }` or `type XxxProps = { ... }` in the file.
 * Regex-based by design — no TS compiler dependency, wrong on exotic types
 * but right for the flat prop interfaces design systems actually use.
 */
export function extractProps(src: string): string[] {
  const m = src.match(/(?:interface|type)\s+\w*Props\b[^{]*\{/);
  if (!m || m.index === undefined) return [];
  const body = readBalanced(src, m.index + m[0].length - 1);
  if (!body) return [];
  const props: string[] = [];
  for (const line of body.split(/[\n;]/)) {
    const field = line.match(/^\s*(?:readonly\s+)?([a-zA-Z_$][\w$]*)\??\s*:/);
    if (field && field[1]) props.push(field[1]);
  }
  return [...new Set(props)];
}

/**
 * Extract variant groups from cva()/tv() calls:
 * `variants: { variant: { default: ..., outline: ... }, size: {...} }`
 * → { variant: ["default","outline"], size: [...] }.
 */
export function extractVariants(src: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const m = src.match(/variants\s*:\s*\{/);
  if (!m || m.index === undefined) return out;
  const body = readBalanced(src, m.index + m[0].length - 1);
  if (!body) return out;
  // Walk top-level `name: {` groups inside the variants object.
  let depth = 0;
  let groupName: string | null = null;
  let groupStart = -1;
  const nameRe = /([a-zA-Z_$][\w$]*)\s*:\s*$/;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") {
      if (depth === 0) {
        const before = body.slice(0, i).replace(/\s+$/, "");
        const nm = before.match(/([a-zA-Z_$][\w$]*)\s*:$/) ?? nameRe.exec(before);
        groupName = nm?.[1] ?? null;
        groupStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && groupName && groupStart !== -1) {
        const groupBody = body.slice(groupStart, i);
        const values = topLevelKeys(groupBody);
        if (values.length > 0) out[groupName] = values;
        groupName = null;
      }
    }
  }
  return out;
}

/** Keys of an object literal body, ignoring anything inside nested brackets. */
function topLevelKeys(body: string): string[] {
  // Blank out nested bracket contents, then match `key:` in what remains.
  let depth = 0;
  let flat = "";
  for (const ch of body) {
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      flat += " ";
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      flat += " ";
    } else {
      flat += depth === 0 ? ch : " ";
    }
  }
  const keys: string[] = [];
  for (const m of flat.matchAll(/(?:^|[,\s])["']?([a-zA-Z_$][\w$-]*)["']?\s*:/g)) {
    if (m[1]) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

/** Return the content between the brace at `openIdx` and its match. */
function readBalanced(src: string, openIdx: number): string | null {
  if (src[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

async function collectCustomProperties(
  cssFiles: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of cssFiles) {
    const src = await safeReadFile(f);
    if (!src) continue;
    for (const match of src.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      const name = match[1];
      const value = match[2];
      if (name && value) out[name] = value.trim();
    }
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeReadFile(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
