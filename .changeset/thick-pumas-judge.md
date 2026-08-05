---
"@objectstack/runtime": patch
---

Deny anonymous callers on the `/actions` and `/automation` dispatch routes (#5519)

`@objectstack/rest`'s `/data` and the dispatcher's `/meta`, `/ai` and `/security`
have answered an unauthenticated caller 401 `UNAUTHENTICATED` since #3963 made
"anonymous access is always denied" a platform promise (the `api.requireAuth`
opt-out is a tombstone). The dispatcher's own `/actions/*` and `/automation/*`
routes — mounted by `dispatcher-plugin.ts` onto the host server, a different
registration path from the REST one — carried no anonymity check at all.

`/actions` was the expensive half: a `script` action's body executes with
`isSystem: true` forced on (`buildActionExecutionContext`), so an
unauthenticated POST bought an RLS/FLS-bypassing SYSTEM write. The only gate
ahead of it was ADR-0066 D4's `requiredPermissions`, which allows every action
that declares none — i.e. most authored actions. On `/automation`, anonymous
callers could trigger a flow run, list every flow, register one, and
unregister one.

Both domains now call the shared `shouldDenyAnonymous` decision before anything
dispatches, returning the same 401 envelope every other seam returns. Finer
authorization is unchanged and still runs for callers who clear the floor —
`requiredPermissions` (ADR-0066 D4), `ai.exposed`, the ADR-0104 param contract.

**What passes unchanged:** any authenticated caller (session, API key or OAuth
principal), and internal `isSystem` contexts. CORS preflight (`OPTIONS`) is
exempt as always. Internal dispatch paths never enter these HTTP handlers and
are untouched — the MCP `run_action` bridge, the declarative endpoint executor
(a `type: 'flow'` endpoint keeps its own `authRequired` gate, so an explicit
`authRequired: false` endpoint stays public), and engine-internal record-change
and schedule triggers.

**Behaviour change to expect:** an unauthenticated call that previously got 200
(or 403 on a `requiredPermissions` action, or 405/501) now gets 401. If a
deployment relied on unauthenticated action or flow invocation, the supported
replacement is a declared endpoint with `authRequired: false`, a public-form
grant, or a share-link token — never an anonymous `/actions` POST.
