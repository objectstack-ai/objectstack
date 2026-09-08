---
'@objectstack/objectql': patch
---

fix(objectql): the audit binder stamps `created_by` from the session on an ordinary create, so a caller-supplied value no longer survives a plain `POST` (#16311)

The `beforeInsert` audit stamp was `record.created_by = record.created_by ?? session.userId` — client-preferred on every insert, with no flag and no privilege required — while its sibling one line down was already the `preserveAudit` ternary. Since the static-`readonly` strip moved INSIDE `engine.insert` (2026-09-03 ruling, option C) it runs AFTER the before-phase hooks, and its guard treats a key a `beforeInsert` hook ASSIGNED as the hook's write rather than a caller forgery. The `??` therefore laundered the caller's bytes past that strip: an authenticated `POST /api/v1/data/OBJECT` carrying `created_by: 'forged_user'` stored exactly that, on an object whose `created_by` is the registry-injected `AUDIT_FIELD_DEFS` shape (`readonly: true`), while `updated_by` in the same payload was correctly overwritten with the session user. A row could claim it was created by a user who did not create it — audit integrity, not privilege escalation.

The stamp now takes the same shape as `updated_by`, one field over, and the same shape #15964 landed for `created_at`:

```ts
record.created_by = preserveAudit ? (record.created_by ?? session.userId) : session.userId;
```

**What changes for a caller.** An ordinary create no longer preserves a supplied `created_by` — the value is overwritten with the session user rather than deleted, so the column is still a real attribution stamp. This narrows the accept set to the `readonly` contract the field already documents; no exported symbol, schema or config key moves.

**The session-less insert is deliberately unchanged, and that is load-bearing.** Both audit-user assignments stay inside `if (session?.userId)`. With no session the hook assigns nothing and the engine's readonly strip takes the caller's value, so the key is absent — already the correct outcome today, reached by a different path. A shape that assigned `session.userId` unconditionally would write `undefined` into the key, making it one the hook "wrote", and the strip would then spare it: a branch that is correct today would become a new hole. That row is pinned.

**The historical-import channel is unchanged and pinned.** `runImport({ treatAsHistorical: true })` sets `preserveAudit: true` on the write context (`@objectstack/rest`), and that branch still reinstates an original `created_by`, exactly as it has for `updated_by` since #3493. This is why the fix is the `preserveAudit` ternary rather than a bare `= session.userId`.

**A creator that supplied a non-session `created_by` under an authenticated session must now ask for it** via `preserveAudit: true`. Creators that write an arbitrary `created_by` through a session-less system context (`{ isSystem: true }` with no `userId`) are untouched: the hook never entered that branch before this change either, and the `isSystem` strip exemption is what carries their value.
