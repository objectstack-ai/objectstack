---
'@objectstack/runtime': patch
---

fix(runtime): on a multi-kernel host, a same-origin `type: 'api'` action run by a REST or MCP request placed only by its scoped URL forwards into the environment the request ran in

Clause-②: no
Metadata-protocol: none

- **The forward is placed where the request ran, at every door.** A same-origin `type: 'api'` action forwards into the host's raw app, which places the forwarded request as it places any request. A request placed by its bound hostname or by its `X-Environment-Id` carries that signal into its forward. A request placed only by its scoped URL (`POST /environments/:env/actions/:object/:action`, or `run_action` on `/environments/:env/mcp`) did not, because the forward targets the action's own path: on a shared origin with no hostname binding the forward landed in no environment, and its target answered a member who may run the action `401`. On a host with a `kernel-resolver`, the forward from the REST, MCP and `dispatchAction` doors now carries the environment the resolver placed the request in as `X-Environment-Id`, replacing any `X-Environment-Id` the caller sent. A request placed in no environment, or in `platform` (the control plane), and every request on a host with no `kernel-resolver`, forwards exactly as before.
