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
  /** Best-effort summary; richer extraction (props, variants) comes later. */
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

const CSS_ENTRY_CANDIDATES = [
  "src/index.css",
  "src/globals.css",
  "src/app/globals.css",
  "app/globals.css",
  "styles/globals.css",
];

export async function scanProject(projectRoot: string): Promise<DesignSystem> {
  const root = path.resolve(projectRoot);
  const [packageJson, tailwindConfigPath, cssEntryPaths, components] =
    await Promise.all([
      readPackageJson(root),
      findFirstExisting(root, TAILWIND_CONFIG_NAMES),
      findExistingMany(root, CSS_ENTRY_CANDIDATES),
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

async function findExistingMany(root: string, candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const name of candidates) {
    const full = path.join(root, name);
    if (await exists(full)) out.push(full);
  }
  return out;
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
      const exportType = await guessExportType(file);
      out.push({ name, filePath: file, exportType });
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

async function guessExportType(file: string): Promise<ComponentEntry["exportType"]> {
  const src = await safeReadFile(file);
  if (!src) return "unknown";
  if (/export\s+default\b/.test(src)) return "default";
  if (/export\s+(?:const|function|class)\s+[A-Z]/.test(src)) return "named";
  return "unknown";
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
