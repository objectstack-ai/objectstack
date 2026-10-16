---
'@objectstack/cli': patch
---

fix(cli): `os serve`'s ready banner prints an `API:` or MCP address only when an HTTP server is composed, and otherwise says once that none is served

Clause-②: no

- **Before.** `os serve --no-server` printed `➜ API: http://localhost:PORT/` and `➜ MCP: http://localhost:PORT/api/v1/mcp` with its "connect an AI client" hint, though `--no-server` had started no HTTP server and nothing listened on that port. An operator, or an AI client configured from the banner, was sent to an address that refused the connection.
- **After, with no HTTP server composed.** The banner prints no `API:`, `Console:` or `MCP:` row, and no connect hint or paths-only note. It prints one line instead: `➜ No HTTP server: --no-server was given and no plugin composed one, so no API or MCP address is served`. The line names `--no-server` only when that flag is the reason; a boot that asked for a server but composed none says `no plugin composed one`.
- **After, with an HTTP server composed.** The address rows are unchanged. That includes a `--no-server` boot whose config mounts its own `HonoServerPlugin`, because the banner checks the booted kernel for a registered `http.server` service rather than reading the flag.

The ready line (`✓ Server is ready` or `⚠ … DEGRADED`) and every row that names no address are unchanged. So are the `objectstack:listening` IPC message and the `runtime.<environment>.<project>.json` state file.
