---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a request for port 0 no longer warns that port 0 is in use

Clause-②: no (no export, option or type moves: a log line stops firing for a legal request)

- **What changed.** `HonoServerPlugin`'s `kernel:listening` hook compared the requested port with the bound one and warned `Port 0 is in use, using port N instead` whenever they differed. Port `0` asks for a kernel-assigned port, so the two can never match and nothing was in use. Every `os serve --port 0` boot printed that warning under the banner's Boot diagnostics, at the default log level and at `info`. The warning now fires only for a non-zero request that the adapter moved to another port.
- **Unchanged.** A kernel-assigned boot prints the existing `HTTP server started successfully` line, which already names the bound port, and nothing else. A non-zero request whose port is held still warns, naming the requested and the bound port.
