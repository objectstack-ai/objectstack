---
'@objectstack/cli': patch
'@objectstack/mcp': patch
---

fix(cli): with the stdio MCP transport on, what a host plugin writes to the console while serving a call reaches stderr

Clause-②: no
Metadata-protocol: none

An MCP client that spawns `os serve` or `os start` over stdio writes `initialize` at once and its first `tools/call` as soon as that is answered, so those calls are served while the server is still finishing its boot. `serve` holds back boot output during that time so the startup banner stays readable, and it held back the calls' output with it: a host plugin's `console.log`, `console.info` and `console.debug` from a tool-call interceptor or a hook reached neither stdout nor stderr. `console.warn` and `console.error` were not affected.

The stdio transport now marks stdout when it claims it, and from that moment `serve` stops holding back console output: it goes to stderr, never to stdout, which still carries only JSON-RPC frames. Under stdio, the part of the boot that runs after the transport starts now prints its own console lines to stderr too, instead of dropping them. A boot without the stdio transport is unchanged.
