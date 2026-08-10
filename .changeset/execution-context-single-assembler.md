---
"@objectstack/core": minor
"@objectstack/runtime": patch
"@objectstack/rest": patch
---

refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

`resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
step after it — turning the resolved envelope into the `ExecutionContext` that
reaches enforcement — was still one hand-written copy per transport, and the
copies drifted twice for real: **#6071** (the REST copy never set
`principalKind`, so every enforcement judgment reading it was silently
never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
produced real 403s on the share-link faces).

**@objectstack/core** gains the single assembly, with the anonymous divergence
as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
A):

- `assembleExecutionContext(input)` — the **fail-closed default** entry. No
  resolved principal → `undefined`, and the surface answers 401.
- `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
  resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
  `positions: ['guest']`), whose consumers are live (`explain-engine`'s
  guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
  semantics serve anonymous principals.
- The field set is **closed by type**: `ExecutionContextEntryFields` requires a
  decision for every `ExecutionContext` field that is not explicitly declared
  non-entry-resolved, so a new field cannot reach one transport and miss
  another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
  `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
  `OAuthTokenProvenance`, `EntryLocalization`.

**@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
that module — the dispatcher via the guest entry, REST via the fail-closed
default.

**No runtime behaviour change on either surface.** The remaining per-face
divergences are required inputs rather than silent omissions: REST passes
`accessToken: undefined` (it has never carried the session bearer on the
envelope, and `session.accessToken` is a published hook surface) and
`oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
one measurable difference is that a key whose value was `undefined` is now
omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
and to spreading the envelope.
