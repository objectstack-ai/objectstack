---
'@objectstack/cli': patch
---

`os serve --no-server` no longer reports an ordering fault for the datasource admin routes. A boot that composes no HTTP server used to print, in its boot diagnostics, `WARN [datasource-admin] route registration failed: [Kernel] Service 'http.server' not found (… a composition/ordering fault; registration order is not a contract.)`, although nothing was at fault. It now prints the routes' own degrade line, `WARN [datasource-admin] http.server unavailable; REST routes not installed`, beside the same boot's other "not mounted" lines.

What still warns: on a boot that does compose an HTTP server, a route registration that throws still prints `[datasource-admin] route registration failed` with the error. A composed boot mounts `/api/v1/datasources` as before, including under `--no-server` when the config mounts its own `HonoServerPlugin`. The plugin now reads only the canonical `http.server` service. Its old fallback to the deprecated `http-server` alias never ran: on a boot without `http.server` the canonical read threw first. So every boot that mounted these routes before still mounts them.
