---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-audit": minor
"@objectstack/plugin-security": minor
---

feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
`sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
purpose** — the route already authorized the action under better-auth's own ACL,
and ADR-0092 D2 refuses user-context writes to those tables outright. The
consequence was that the human who clicked *make admin* was known exactly once,
in the hook layer where the session exists, and then discarded: every
`trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
and `sys_user_permission_set.granted_by` was written null by the auto-grant.
"Who made this person an org admin?" had no answer in the platform's own audit
log.

**What changed**

A request-scoped attribution seam, general rather than a `sys_member` special
case:

| Layer | Before | After |
|:--|:--|:--|
| `ExecutionContext` | `userId` / `actor` only | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED |
| `HookContext` | `session`, `user` | new `provenance.attributedUserId`, split off the context beside `session` |
| better-auth ObjectQL adapter | `{ isSystem: true }` | `{ isSystem: true, attributedUserId }` when a request scope is open |
| audit writer | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody |
| `auto-org-admin-grant` | `granted_by: null`, no `reason` | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
and audit rows keep recording `null`. Absence is still never upgraded into a
caller, and never written as a sentinel string (ADR-0118 D1/D2).

**Hard constraint — attribution is not authority**

`attributedUserId` is read by exactly one consumer, the audit writer, and by no
security middleware. It never becomes `ExecutionContext.userId`, so it is never
the subject the engine authorizes as: not RLS `current_user`, not the ownership
stamp, not permission resolution. A context carrying only `attributedUserId`
authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
identity writes as the human would re-adjudicate a decision better-auth already
made — the second adjudication track ADR-0095 D3 closed. The constraint is
pinned by tests at three layers: the engine seam
(`packages/objectql/src/engine.test.ts`), the better-auth adapter
(`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
live HTTP route (a plain member still cannot promote themselves).

**For authors and plugin developers**

`attributedUserId` is authorable on `ExecutionContext` and readable as
`ctx.provenance?.attributedUserId` in hooks. Use it to answer *who is
responsible*; keep using `ctx.session` / `ctx.user` to decide *what is
permitted*. The two are separate fields precisely so the distinction cannot be
blurred by accident.
