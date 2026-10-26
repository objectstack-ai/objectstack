---
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

feat(runtime,cli): a hook body reads `ctx.provenance`, so a guard that tells a flow's write from a user's own write ships as metadata

Clause-②: no
Metadata-protocol: none

The sandboxed hook body now carries the declared `HookContext.provenance`, the same server-stamped write provenance an in-process handler reads. `ctx.provenance.flowRunId` is the flow run's id on a write from a flow data node, `attributedUserId` and `performedByClientId` ride along when the engine stamps them, each member is a string or absent, and `ctx.provenance` is absent on a write with no origin (a plain REST write). Read it as `ctx.provenance?.flowRunId`. The object is frozen in the VM, and it is built from the server-side execution context, so a payload field named `provenance` stays on `ctx.input` and never reaches it.

`objectstack build` therefore lowers a hook handler that reads `ctx.provenance` into a metadata-only body instead of bundling it, and `os lint` no longer reports `hook-body/bundled-fallback` for that read. Nothing to migrate: a handler that read `ctx.provenance` was bundled before and runs in-process, where it behaves the same; rebuilding turns it into a body.
