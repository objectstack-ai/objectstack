---
"@objectstack/runtime": patch
---

fix(runtime): `ctx.user.name` is the acting user's display name, on every dispatch path (#5372)

An action body reading `ctx.user.name` got the raw user id back — a *declared*
key delivering a plausible **wrong value**, which is the failure mode
"declared = enforced" exists to prevent. Nothing downstream can detect it: the
value is a perfectly good string, so no `??` chain and no consumer-side guard
tells it apart from a real name. Apps that trusted the declaration wrote opaque
ids into user-facing surfaces (an activity timeline rendering
`usr_01j…` as its actor for every logged activity).

Three dispatchers built the caller's `user` object three different ways, and
all three landed on the id:

- **REST `/actions`** hardcoded `name: ec.userId`.
- **MCP `run_action`** read `ec.userName ?? ec.userDisplayName ?? ec.userId`.
  Neither alias is declared on `ExecutionContextSchema` and nothing ever
  assigned either, so the chain's only reachable arm was the id.
- **The AI routes** spelled the key `displayName` (same dead chain behind it)
  and read the caller's address off `ec.userEmail` — the declared field is
  `ec.email` — so `req.user.email` there was permanently `undefined`.

**What changes.** One shared producer builds the user envelope for all three
paths. `name` now carries `sys_user.name`, the platform's own profile
display-name column, resolved once per request (a memo keyed on the request's
ExecutionContext, so N action dispatches in one request cost one indexed read
— ~0.22 ms measured against real SQLite — and nothing is cached across
requests, so a rename takes effect on the user's next request).

Resolution is **quiet**: no `sys_user` row, no engine, a failing read or a blank
name falls back to the id. A missing display name never fails an action. So
`name === id` now means exactly one thing — *this user has no resolvable display
name* — which is what makes the fix detectable from application code: any
workaround of the form "if `ctx.user.name` differs from `ctx.user.id`, trust
it; otherwise look the name up myself" **self-retires** the moment this lands,
with no coordinated deploy.

**One shape, and it is the spec's.** [ADR-0068 D1] declares `EvalUser` as the
one user-context contract, mounted under `current_user` / `user` / `ctx.user`
on the predicate surface — with `name` on it, meaning "display name". The
dispatch envelope's identity core is now built through that same
`createEvalUser` factory, so an action's `visible` predicate and its `body` —
both spelled `ctx.user` — see one object: `id`, `name`, `email`, `positions`,
`isPlatformAdmin`, `organizationId`. On top of that core the dispatch surfaces
keep publishing what they already published: `userId` and `displayName`
(aliases of `id` / `name`, same values), `roles` (the pre-ADR-0090 alias of
`positions`), and the two authority channels `permissions` (permission-set
names) and `systemPermissions` (capabilities), still side by side and never
merged. Additive for every existing reader; no key was removed.

The AI routes' second `req.user` producer (the concrete per-route mounts) is
built by the same function, so the two can no longer drift apart by hand. Its
display name comes from the session's own `user.name`, needing no extra read;
its former `?? user.email` middle arm is gone so that `name === id` means the
same thing on every producer — the address is still served under `email`.

`buildActionSandboxContext` is unchanged: it passed the user through verbatim
all along, and was never where the name was lost.
