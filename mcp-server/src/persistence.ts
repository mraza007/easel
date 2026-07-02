import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { canvas } from "./state.js";
import type { Artboard, CanvasComment } from "./types.js";

const FORMAT_VERSION = 1;

const DEFAULT_PATH =
  process.env.EASEL_STATE_FILE ?? path.join(os.homedir(), ".easel", "state.json");

interface FileFormat {
  version: number;
  documentName?: string;
  artboards: Artboard[];
  comments?: CanvasComment[];
}

export const STATE_FILE_PATH = DEFAULT_PATH;

/**
 * If a saved state file exists, load it; the canvas adopts those artboards
 * and the document name. Returns true if state was loaded (so the caller can
 * skip seeding).
 */
export async function loadIfExists(filePath = DEFAULT_PATH): Promise<boolean> {
  return applyFromDisk(filePath, /*warnOnVersionMismatch*/ true);
}

/**
 * Force-reload the state file. Used by the reload-state mutation when the
 * in-memory tree may have drifted from disk (e.g. another process wrote it).
 */
export async function reloadFromDisk(
  filePath = DEFAULT_PATH,
): Promise<{ ok: boolean; mtime: number | null }> {
  const ok = await applyFromDisk(filePath, false);
  const mtime = await statMtime(filePath);
  return { ok, mtime };
}

async function applyFromDisk(filePath: string, warn: boolean): Promise<boolean> {
  const raw = await safeRead(filePath);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<FileFormat>;
    if (parsed.version !== FORMAT_VERSION) {
      if (warn) {
        // eslint-disable-next-line no-console
        console.warn(
          `[easel] ignoring state at ${filePath}: version ${parsed.version} != ${FORMAT_VERSION}`,
        );
      }
      return false;
    }
    if (!Array.isArray(parsed.artboards)) return false;
    canvas.setArtboards(parsed.artboards as Artboard[], { clearHistory: true });
    if (typeof parsed.documentName === "string") {
      canvas.setDocumentName(parsed.documentName);
    }
    if (Array.isArray(parsed.comments)) {
      canvas.setComments(parsed.comments as CanvasComment[]);
    }
    return true;
  } catch (err) {
    if (warn) {
      // eslint-disable-next-line no-console
      console.warn(`[easel] could not parse ${filePath}:`, err);
    }
    return false;
  }
}

async function statMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

export async function getStateFileMtime(filePath = DEFAULT_PATH): Promise<number | null> {
  return statMtime(filePath);
}

/**
 * Subscribe to canvas changes and persist with a debounce. Returns a disposer.
 * Persists artboards on tree change AND when document metadata changes.
 */
export function startAutosave(filePath = DEFAULT_PATH, debounceMs = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    const data: FileFormat = {
      version: FORMAT_VERSION,
      documentName: canvas.getDocumentName(),
      artboards: canvas.getArtboards(),
      comments: canvas.getComments(),
    };
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, filePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[easel] autosave failed:", err);
    }
  };

  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  const unsubscribeTree = canvas.subscribe(schedule);
  const unsubscribeMeta = canvas.subscribeMetadata(schedule);
  const unsubscribeComments = canvas.subscribeComments(schedule);

  return () => {
    unsubscribeTree();
    unsubscribeMeta();
    unsubscribeComments();
    if (timer) {
      clearTimeout(timer);
      void flush();
    }
  };
}

async function safeRead(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
