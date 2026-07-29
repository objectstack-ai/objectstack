---
"@objectstack/runtime": patch
---

fix(runtime): action bodies execute under a real execution context — every owner-scoped write no longer dies FORBIDDEN

An action body's `ctx.api` was never bound. The sandbox's `buildSandboxApi`
walked its whole fallback chain — no `actionCtx.api`, and the raw `ObjectQL`
engine has no `.object()` (that lives on `ScopedContext`, reachable only via
`engine.createContext()`, which the action path never called) — and landed on a
repo facade that proxied every call to the engine with **no `context`**.
`ctx.engine` had the identical hole.

Context-less is not "trusted", it is **identity-less**, and identity-less is
strictly worse than either coherent posture: plugin-sharing's write gate
short-circuits on `!context.userId` (no user to own the record) and its bypass
needs `context.isSystem` (never set). So a `type: 'script'` action whose body
called `ctx.api.object('crm_case').update(...)` failed with
`FORBIDDEN: insufficient privileges to update crm_case` — **as the built-in
admin** — while the `[action-audit]` line on the same request announced
RLS-bypassing TRUSTED execution. Objects with a `public` sharing model, no
owner field, or a bypass listing passed the gate early, so only *some* actions
broke and the defect read as object-dependent flakiness.

Both dispatch paths (REST `/actions/:object/:action` and MCP `run_action`) now
bind `ctx.api` to `engine.createContext(...)` and thread the same envelope
through `ctx.engine`, matching what hook bodies already get from the engine's
`buildHookApi`. The envelope is the caller's `ExecutionContext` elevated with
`isSystem: true` — the posture the action surface already documents and gates
for at invoke time (the ADR-0066 D4 capability gate and the `ai.exposed` gate
are what admit a body to trusted execution). The caller's fields are spread
first, so a body's writes stay attributable (`userId` stamps
`created_by`/`updated_by`), org-scoped (`tenantId` stamps the org column and
drives driver-level tenant isolation), and joined to an open transaction —
rather than the unattributable, org-less rows a bare `{ isSystem: true }` would
write.

No authoring change is required: `ctx.api.object(name)` inside a `body` now
does what the docs always said it does. Bodies that worked before (public /
owner-less objects) are unaffected apart from their writes now being correctly
attributed and org-stamped.
