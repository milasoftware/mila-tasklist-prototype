---
name: mila-dev-preview
description: >-
  Starts the Mila Vite dev server and opens the app for preview in Cursor.
  Use when the user wants localhost:5173, to spin up the dev server, preview
  the prototype in the browser, or open the mila UI during development.
---

# Mila dev preview (localhost:5173)

## Preconditions

- Repo root: workspace root (has `package.json` with script `"dev": "vite"`).
- Default URL: `http://localhost:5173/`

## Workflow

1. **Avoid duplicate servers**  
   Check existing terminals for an already-running `vite` / `npm run dev` on this project. If Vite already printed `Local: http://localhost:5173/`, skip starting a new process.

2. **Start the server**  
   From the workspace root:
   ```bash
   npm run dev
   ```
   Run as a **background** job so the agent can continue (long-running).

3. **Smoke-check**  
   Read the terminal output once to confirm `ready` and `http://localhost:5173/` (or note the actual port if Vite chose another).

4. **Show it in Cursor**  
   Prefer opening the URL for the user inside Cursor:
   - If **cursor-app-control** MCP exposes `open_resource`: call it with URI `http://localhost:5173/` so Glass / Simple Browser opens per the user’s Cursor settings.
   - Otherwise tell the user: **Command Palette** → `Simple Browser: Show` → paste `http://localhost:5173/`.

5. **Optional agent preview**  
   If **cursor-ide-browser** MCP is enabled and the goal is automated verification, use `browser_navigate` to `http://localhost:5173/` after the server is ready.

## Notes

- No `.env` required for local preview; data is bundled from `src/data.generated.json`.
- If port 5173 is busy, Vite picks the next free port — read the terminal line `Local:` and use that URL everywhere.
