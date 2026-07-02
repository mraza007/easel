# Easel

> A canvas your coding agent paints on.

Open-source visual canvas for AI coding agents. Designs render as real HTML on a 2D canvas — no shape-to-code translation step. An MCP server hands the canvas (and your project's tokens and components) to Cursor or any MCP-capable agent, so the agent can compose UI visually, read what the user has selected, and ship idiomatic React using your existing design system.

Self-hosted, runs locally, no telemetry. Built for environments where SaaS design tools aren't an option.

## How it works

```
+----------------+    WebSocket    +-----------------+    stdio    +-------+
|  Easel canvas  |  <------------- |  Easel MCP      | <---------- |  IDE  |
|  (web app)     |    state +      |  server         |  tools      |  agent|
|                |    selection    |                 |             |       |
+----------------+ <-------------> +-----------------+             +-------+
                                          |
                                          v
                                   +-----------------+
                                   |  ds-scanner     |
                                   | reads project's |
                                   | tailwind config,|
                                   | components/ui,  |
                                   | tokens          |
                                   +-----------------+
```

1. The canvas (`pnpm canvas`) runs at `http://localhost:5173`.
2. Your IDE agent spawns the MCP server, which binds a local WebSocket on `127.0.0.1:7777` (falling back through `7778`–`7786` if taken — the canvas probes the same range) and holds canonical state. Browser connections must come from a localhost origin.
3. You ask the agent to build something. It paints HTML on the canvas using your real tokens. You watch live.
4. Selection syncs both ways. Click on the canvas → agent's `get_selection` returns it. Agent calls `set_selection` → indigo ring jumps on your screen.
5. When you're happy, ask the agent to ship it. It reads the tree (`get_jsx`, `get_computed_styles`, `get_screenshot`) and writes idiomatic JSX into your repo using your `<Button>`, your tokens, your conventions.

## Requirements

- **Node.js 20+** (`node --version`)
- **pnpm 8+** (`pnpm --version`) — `npm install -g pnpm`
- A Chromium-based browser for the canvas (Chrome, Edge, Arc, Brave, etc.)

## Install

```bash
git clone git@github.com:mraza007/easel.git
cd easel
pnpm setup    # installs deps, builds ds-scanner + mcp-server
pnpm canvas   # starts only the web canvas at http://localhost:5173
```

`pnpm canvas` deliberately does **not** start the MCP server — your IDE agent will spawn its own copy via stdio (next section). That keeps WS port 7777 free for whichever agent is in charge.

Open `http://localhost:5173` once the canvas is up. Status pill in the top-right will say **OFFLINE** until you wire an agent.

## Wiring an agent

Easel works with any MCP-capable agent. The fastest path is the bundled installer.

### Cursor (recommended)

```bash
pnpm install:cursor                                    # use the easel repo as the design-system source
pnpm install:cursor -- --project-root ~/code/my-app    # or point at your real React project
```

The script:

- Writes `~/.cursor/mcp.json` (creates it if missing, preserves any servers already there).
- Sets `EASEL_PROJECT_ROOT` to the path you pass — that's the directory `ds-scanner` reads at startup to detect Tailwind config, components, and CSS variables. Point it at the React project you want the agent to translate designs *into*.
- Idempotent — re-run any time you want to change the project root.

After running it:

1. Start the canvas (`pnpm canvas`).
2. Restart Cursor (or toggle `easel` under **Settings → Tools & MCP**).
3. In Cursor chat: *"use the easel MCP — what's on the canvas?"*

### Manual config

If you'd rather hand-edit, `cursor.example.json` at the repo root has the exact JSON shape. Copy it into `~/.cursor/mcp.json` and replace the absolute paths.

For a project-scoped install, put the same JSON at `.cursor/mcp.json` inside that project. Project config wins over global if both define `easel`.

### Other MCP-capable agents

The MCP server is a plain stdio binary at `mcp-server/dist/index.js` (run `pnpm setup` first). Any tool that can spawn an MCP stdio process works — point it at that path and set `EASEL_PROJECT_ROOT` to enable design-system introspection.

## Sample prompts

After wiring an agent, try:

```
Use the easel MCP to tell me what's on the canvas.
```
Calls `get_basic_info`. The agent summarizes the seed artboard.

```
Use easel to add a "Pricing" artboard with three cards side-by-side.
```
Watch the artboard appear and fill in live as the agent calls `create_artboard` + `write_html`.

```
I've selected a button on the canvas. Use easel to read what's selected and
make it bigger and indigo.
```
Calls `get_selection`, then `update_styles`. No node-id pasting.

```
Read the Pricing artboard via get_jsx + get_computed_styles, then write it as
a React component to src/Pricing.tsx using semantic Tailwind classes.
```
The full agent → real-code loop. The screenshot tool gives the agent visual grounding when computed styles aren't enough.

## What the agent can do (30 MCP tools)

**Read:** `get_basic_info`, `get_design_system`, `get_tree`, `get_node_info`, `get_jsx`, `get_computed_styles`, `get_screenshot`, `get_selection`

**Write:** `create_artboard`, `write_html`, `update_styles`, `apply_token`, `set_text`, `set_layer_name`, `set_document_name`, `delete_node`, `duplicate_artboard`, `move_artboard`, `reset_canvas`, `set_selection`, `undo`, `redo`

**Design workflow:** `design_to_code` (one-call translation brief), `diff_artboards` (structured tree/style diff), `create_variant` / `get_variants` (linked responsive variants), `insert_component` (render a real project component in a sandboxed iframe), `add_comment` / `get_comments` / `resolve_comment` (notes pinned to nodes — the agent explains choices, you reply on the canvas)

All HTML written to the canvas is sanitized (tag allowlist, no event handlers, no `javascript:` URLs). `insert_component` bundles the component from your project's own source and `node_modules` with esbuild; CSS imports are stubbed in v1, so Tailwind-styled components render unstyled for now.

## What you can do directly (no agent)

| Action | How |
|---|---|
| Pan / zoom | Drag empty canvas / `cmd+scroll` |
| Fit view | `Shift+1` all artboards, `Shift+2` selection |
| Select | Click on canvas or layer tree; `Shift+click` for multi-select |
| Deselect | Click empty canvas, or `Esc` |
| Move artboard | Drag its surface or label — edges snap to other artboards; arrow keys nudge (`Shift` = 10px) |
| Resize | Drag the handles on the selection's east/south/corner edges |
| Edit styles | Style inspector on the right — edits apply to every selected node |
| Edit text | Double-click any text → type → `Enter` (or blur); `Esc` cancels |
| Insert elements | Press `I` — text, heading, button, image, stack, row, card |
| Reorder layers | Hover a row in the layer tree → `↑`/`↓` |
| Undo / redo | `⌘Z` / `⌘⇧Z` — includes agent edits, and agents can undo too |
| Delete | Select, then `Delete` or `Backspace` |
| Comments | Click a pin on the canvas, read/reply/resolve in the inspector |
| Tokens | Design-system panel in the sidebar — click a token to copy `var(--name)` |
| New artboard | Click `+` next to "ARTBOARDS" in the sidebar |
| Duplicate artboard | Select an artboard, press `⌘D` |
| Rename document | Click the file name in the topbar |
| Rename artboard | Double-click its name in the layer tree |
| Server menu | Click the connection pill — Reload from disk, Reconnect, Reset |

## Persistence

State (artboards, document name, comments) autosaves to `~/.easel/state.json` (override with `EASEL_STATE_FILE`). 500ms debounce, atomic write via `.tmp` + rename. Loads on boot. Delete the file to wipe back to the seed.

If the canvas and disk ever drift (e.g. a stale agent process left in-memory state behind), use **Reload from disk** in the server menu — recovers in one click.

## Troubleshooting

**Status pill says OFFLINE forever.**
No MCP server is listening on `127.0.0.1:7777`–`7786`. Check that your IDE has spawned it — in Cursor, look under Settings → Tools & MCP and confirm `easel` is enabled. To see what's holding ports in the range:

```bash
lsof -nP -iTCP:7777-7786 -sTCP:LISTEN
```

Multiple agents can run their own servers side by side (each takes the next free port); the canvas connects to the first one it finds.

**Canvas shows different content than `~/.easel/state.json`.**
A stale mcp-server is running in parallel and serving stale in-memory state. Open the server menu (click the connection pill) and use **Reload from disk**.

**The agent says it can't find a node id.**
You probably restarted the server while the canvas had stale ids in its store. Hard-refresh the browser (`⌘+shift+R`) so it adopts the server's current state.

## Packages

- **`app/`** — Vite + React canvas. Real HTML/CSS, pannable + zoomable, layer tree, selection, autosave indicator, server-management menu.
- **`mcp-server/`** — Node MCP server (stdio). Holds canonical tree state (with undo history), bridges to the canvas via WebSocket, bundles project components with esbuild. 30 tools today.
- **`ds-scanner/`** — Project introspection. Auto-detects Tailwind config (v3 + v4 `@theme`), component library with props and cva variants, design tokens, CSS custom properties from a project root.

## Status

Alpha. The agent-driven canvas is functional end-to-end: editing (undo/redo, drag, resize, multi-select, style inspector, insert palette), design-system awareness (tokens rendered and applied, real components sandboxed on the canvas), and agent collaboration (comments, diffs, responsive variants). Next up: per-project state, `npx` distribution, and compiling project Tailwind CSS into component sandboxes.

## License

MIT.
