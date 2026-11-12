---
'@objectstack/runtime': patch
---

fix(runtime): on a multi-kernel host, a same-origin `type: 'api'` action called through `dispatchAction` forwards into the environment the call ran in

Clause-②: no
Metadata-protocol: none

- **The forward is placed where the call ran.** `dispatchAction(hostKernel, { environmentId, … })` places the call on the environment's own kernel, and a same-origin `type: 'api'` action then forwards into the host's raw app, which places the forwarded request as it places any request. A REST request carries what placed it (its `Host`, its `X-Environment-Id`) into its forward; the host door's request carried neither, so the forward arrived as `Host: localhost`, landed in no environment, and its target answered the caller `401` where the REST door answered `200`. On a host with a `kernel-resolver`, the forward now carries the environment the resolver placed the call in as `X-Environment-Id`. It is the resolver's answer: an `X-Environment-Id` in `credentialHeaders` does not move it. A host with no `kernel-resolver` forwards exactly as before.
- **An environment's own kernel still cannot forward.** Handed to `dispatchAction`, a kernel with no HTTP server (an environment's kernel on a multi-kernel host owns no socket) refuses a same-origin `type: 'api'` action `503 SERVICE_UNAVAILABLE`, as before. The sentence at this door now names the remedy: pass the kernel your HTTP door is served from, which on a multi-kernel host is the kernel that registers `kernel-resolver`, with the call's `environmentId`. The REST and MCP doors keep their sentence.
