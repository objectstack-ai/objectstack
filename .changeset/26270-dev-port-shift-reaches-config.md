---
'@objectstack/cli': patch
---

fix(cli): when `os dev` shifts off a busy port, the config reads the port the server binds

Clause-②: no
Metadata-protocol: none

- **Before.** The development auto-shift ran in the `serve` child, after `os dev`'s compile and the child's own config load had both read the requested port. On `examples/app-showcase` with 41310 held, `os dev -p 41310` printed `Port 41310 is in use — serving on 41311 instead`, yet `GET /api/v1/meta/connector/showcase_status_api` served `http://127.0.0.1:41310` and `showcase_declarative_connector_ping` answered `400 FLOW_FAILED`. The same held for a port from `OS_PORT`, and for a direct `os serve --dev` (or `os serve` under `NODE_ENV=development`), whose dispatch dialled the busy port.
- **Now.** `os dev` runs the same walk before it compiles. On a shift it prints the same notice, exports the port it landed on as `OS_PORT`/`PORT` (the channel a port flag already uses) for the compile, the watch recompiles and the server, and hands the server that port. `os serve` exports its shifted port the same way before it loads the config and before a direct `os serve --dev` compiles. The same boots now serve and ping the port they bound, and the ping answers 200.
- Not covered: a port taken between `os dev`'s probe and the server's bind makes the server shift once more. It says so and its own config reads the new port, but `/api/v1/meta` keeps the probed one until the next recompile.
