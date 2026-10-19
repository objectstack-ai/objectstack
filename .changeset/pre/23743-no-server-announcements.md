---
'@objectstack/cli': patch
---

fix(cli): an `os serve` boot that binds no HTTP server sends no `objectstack:listening` message and writes no runtime state file, and the banner's `MCP:` row prints only when the MCP route is mounted

Clause-②: no

- **Before.** `os serve --no-server`, with no transport composed, sent `{ type: 'objectstack:listening', port, url: 'http://localhost:PORT' }` over an `ipc` channel and wrote `runtime.<environment>.<project>.json` with the same `port` and `url`. Nothing listened on that port: a `GET` to it was refused. The docs define `objectstack:listening` as "The HTTP server is bound".
- **After, for a supervisor of a boot that binds no HTTP server** (`--no-server` with no config-mounted transport, or a transport plugin that did not load). It receives no `objectstack:listening` message. It still receives `objectstack:seed-settled`, which is then the boot's only message, so a parent waiting for the seed to settle does not hang. No `runtime.<environment>.<project>.json` is written, so "is my server running, and where?" gets no answer naming an address. The file's payload, where it is written, is unchanged.
- **After, with an HTTP server composed.** Unchanged: the state file is written first, then the banner prints, then `objectstack:listening` is sent with the port actually bound, and `objectstack:seed-settled` follows it. That includes a `--no-server` boot whose config mounts its own `HonoServerPlugin`. The banner, the IPC message and the state file read the same check, a registered `http.server` service on the booted kernel, so they agree on whether there is an address.
- **The banner's `MCP:` row.** It and its "connect an AI client" hint now also require the plugin that mounts `/api/v1/mcp`, the runtime dispatcher, to be registered on the kernel. `os serve` composes the dispatcher only under `--server`. So a `--no-server` boot whose config mounts its own `HonoServerPlugin` prints `API:` but no longer prints an `MCP:` address, which answered 404 there.
