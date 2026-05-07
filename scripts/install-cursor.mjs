#!/usr/bin/env node
/**
 * Install (or update) the easel MCP server in Cursor's global config.
 *
 * Idempotent — preserves other servers in ~/.cursor/mcp.json, only overwrites
 * the "easel" entry. Performs an atomic write via .tmp + rename.
 *
 * Usage:
 *   node scripts/install-cursor.mjs [--project-root <abs-path>]
 *
 * --project-root sets EASEL_PROJECT_ROOT, the directory ds-scanner reads to
 * detect Tailwind config / components / CSS variables. Defaults to the easel
 * repo itself; point at your real React project for design-system-aware
 * translation.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const mcpServerPath = path.join(repoRoot, "mcp-server", "dist", "index.js");

const args = process.argv.slice(2);
const flag = args.indexOf("--project-root");
const projectRoot =
  flag !== -1 && args[flag + 1] ? path.resolve(args[flag + 1]) : repoRoot;

const cursorDir = path.join(os.homedir(), ".cursor");
const cursorConfig = path.join(cursorDir, "mcp.json");

async function main() {
  try {
    await fs.access(mcpServerPath);
  } catch {
    fail(
      "mcp-server is not built.\n" +
        "  Run `pnpm setup` first, then re-run this script.",
    );
  }

  let config = { mcpServers: {} };
  try {
    const raw = await fs.readFile(cursorConfig, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") config = parsed;
    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      fail(`Could not parse ${cursorConfig}: ${err.message}`);
    }
  }

  const existing = config.mcpServers.easel;
  config.mcpServers.easel = {
    type: "stdio",
    command: "node",
    args: [mcpServerPath],
    env: { EASEL_PROJECT_ROOT: projectRoot },
  };

  await fs.mkdir(cursorDir, { recursive: true });
  const tmp = `${cursorConfig}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n");
  await fs.rename(tmp, cursorConfig);

  const verb = existing ? "Updated" : "Installed";
  console.log(`✓ ${verb} easel MCP server in Cursor.`);
  console.log(`  config:             ${cursorConfig}`);
  console.log(`  server:             ${mcpServerPath}`);
  console.log(`  EASEL_PROJECT_ROOT: ${projectRoot}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Run `pnpm canvas` to open http://localhost:5173.");
  console.log("  2. Restart Cursor (or toggle easel under Settings → Tools & MCP).");
  console.log('  3. Try: "use the easel MCP — what\'s on the canvas?"');
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

main().catch((err) => fail(err.message ?? String(err)));
