---
'@objectstack/cli': patch
---

fix(cli): `os dev -p N` and `os serve --port N` export the port as `OS_PORT`/`PORT`, so a config that reads the port sees the one the server listens on

Clause-②: no
Metadata-protocol: none

- **Before.** The port flag reached the listener only. A config that builds a URL from `OS_PORT`/`PORT` while it loads, such as `examples/app-showcase`'s self URL, got the inherited value or the 3000 default. On the showcase with no `OS_PORT`/`PORT`, `os dev -p 41302` and `os serve --port 41303` both served `GET /api/v1/meta/connector/showcase_status_api` with `http://127.0.0.1:3000`, and the self-ping flow answered `400 FLOW_FAILED … fetch failed`.
- **Now.** `os dev` and `os serve` export the port the flag selected as both `OS_PORT` and `PORT` before anything loads the config, the way `os start` already handed it to its server. Under `os dev` that covers the compile, the watch recompiles and the server. The flag overrides an inherited `OS_PORT` for the config, as it already did for the listener. The same two boots now serve `:41302` / `:41303`, and the ping answers 200.
- With no port flag, the environment is left as it is. The exported value is the parsed port (`--port 3e3` exports `3`, the port it selects).
