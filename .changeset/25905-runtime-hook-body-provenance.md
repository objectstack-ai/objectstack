---
'@objectstack/runtime': patch
---

feat(runtime): a hook body reads `ctx.provenance`, so a guard that tells a flow's write from a user's own write ships as metadata

Clause-②: yes (widening)
Metadata-protocol: none

The sandboxed hook body now carries the declared `HookContext.provenance`, the same server-stamped write provenance an in-process handler reads. On a write from a flow data node, `ctx.provenance.flowRunId` is that flow run's id. `attributedUserId` and `performedByClientId` ride along when the engine stamps them. Each member is a string or absent, and `ctx.provenance` itself is absent on a write with no origin, such as a plain REST write. Read it as `ctx.provenance?.flowRunId`. The object is frozen in the VM. It is built from the server-side execution context, so a payload field named `provenance` stays on `ctx.input` and never reaches it.

The widening is on the published type surface. `ScriptContext`, exported from the `@objectstack/runtime` barrel, gains one optional member: `provenance?: { flowRunId?: string; attributedUserId?: string; performedByClientId?: string }`. Measured on `dist/index.d.ts` before and after the change:
- the file grows from 338119 to 339467 bytes;
- the export list is byte-identical, with the same 184 names;
- the only declaration that changes is that one member and its doc comment.

Nothing to migrate: the member is optional, and a `ScriptRunner` that ignores it behaves exactly as before.
