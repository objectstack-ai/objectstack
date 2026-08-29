---
"@objectstack/cli": patch
---

fix(cli): `os serve` publishes the port it BOUND, not the one it was asked for (#13062)

The three channels `serve` announces an address on — the `objectstack:listening`
IPC message, the ready banner's `API:` row and `runtime.<environment>.json` —
were three outputs of one number, and that number was the port the operator
requested. For every port but one the requested and the bound value coincide, so
this stayed invisible; `0` is the value where they cannot coincide.
`MIN_PORT = 0` is legal on purpose (`utils/port-contract.ts`: 0 is "a REQUEST,
not an error" — `listen(0)` binds a kernel-assigned port).

FROM (`os serve --port 0`): IPC `{ port: 0, url: 'http://localhost:0' }`, banner
`API: http://localhost:0/`, `runtime.env_local.json` `"port": 0` — three
channels naming an address nothing was listening on, with nothing erroring.

TO: all three name the port the HTTP server actually bound, read off the
transport's own `IHttpServer.getPort()` (the contract member that already
promises "the real bound port — in particular when `listen(0)` requested an
ephemeral port"). The same repair covers a bind that walked past a port taken
between `serve`'s probe and the transport's `listen()`.

Unchanged for every other port: when the requested port is the bound one — which
is every ordinary boot, including one that dev-auto-shifted off a busy port —
all three channels publish exactly what they published before. A boot with no
HTTP server, or a transport that does not implement the optional member, also
falls back to the previous value.
