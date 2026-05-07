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
2. Your IDE agent spawns the MCP server, which binds a local WebSocket on `127.0.0.1:7777` and holds canonical state.
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

## What the agent can do (17 MCP tools)

**Read:** `get_basic_info`, `get_design_system`, `get_node_info`, `get_jsx`, `get_computed_styles`, `get_screenshot`, `get_selection`

**Write:** `create_artboard`, `write_html`, `update_styles`, `set_text`, `set_layer_name`, `set_document_name`, `delete_node`, `duplicate_artboard`, `reset_canvas`, `set_selection`

## What you can do directly (no agent)

| Action | How |
|---|---|
| Pan / zoom | Drag empty canvas / `cmd+scroll` |
| Select | Click on canvas or layer tree |
| Deselect | Click empty canvas, or `Esc` |
| Edit text | Double-click any text → type → `Enter` (or blur); `Esc` cancels |
| Delete | Select, then `Delete` or `Backspace` |
| New artboard | Click `+` next to "ARTBOARDS" in the sidebar |
| Duplicate artboard | Select an artboard, press `⌘D` |
| Rename document | Click the file name in the topbar |
| Rename artboard | Double-click its name in the layer tree |
| Server menu | Click the connection pill — Reload from disk, Reconnect, Reset |

## Persistence

State autosaves to `~/.easel/state.json` (override with `EASEL_STATE_FILE`). 500ms debounce, atomic write via `.tmp` + rename. Loads on boot. Delete the file to wipe back to the seed.

If the canvas and disk ever drift (e.g. a stale agent process left in-memory state behind), use **Reload from disk** in the server menu — recovers in one click.

## Troubleshooting

**Status pill says OFFLINE forever.**
The MCP server isn't bound to `127.0.0.1:7777`. Check that your IDE has spawned it — in Cursor, look under Settings → Tools & MCP and confirm `easel` is enabled. If something else is holding the port:

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN -t | xargs kill
```

**Canvas shows different content than `~/.easel/state.json`.**
A stale mcp-server is running in parallel and serving stale in-memory state. Open the server menu (click the connection pill) and use **Reload from disk**.

**The agent says it can't find a node id.**
You probably restarted the server while the canvas had stale ids in its store. Hard-refresh the browser (`⌘+shift+R`) so it adopts the server's current state.

## Packages

- **`app/`** — Vite + React canvas. Real HTML/CSS, pannable + zoomable, layer tree, selection, autosave indicator, server-management menu.
- **`mcp-server/`** — Node MCP server (stdio). Holds canonical tree state, bridges to the canvas via WebSocket. 17 tools today.
- **`ds-scanner/`** — Project introspection. Auto-detects Tailwind config, component library, design tokens, CSS custom properties from a project root.

## Status

Pre-alpha. Shape 1 (agent-driven canvas) is functional end-to-end with selection, inline edit, multi-artboard organisation, and server-management UI. Style inspector and Tailwind class round-tripping are next.

## License

MIT.
