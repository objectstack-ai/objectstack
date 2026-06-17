---
"@objectstack/plugin-security": minor
---

fix(security): enforce row-level security on by-id writes — close the member-can-edit-others'-records hole (#1985).

A single-id `update`/`delete` goes straight to `driver.update(object, id, …)` / `driver.delete(object, id)` and builds no query `ast`, so the RLS `where` filter the middleware injects on the read path was **never applied to by-id writes**. Combined with `member_default` granting `*: { edit, delete }` (scoped, by design, via the `owner_only_writes/deletes` RLS), this meant the owner predicate was silently bypassed: **any authenticated member could modify or delete another user's records** (verified end-to-end — a member PATCH'd an admin's record and the change persisted).

Two coordinated changes:

- **Enforce a pre-image authorization check.** Before a single-id `update`/`delete`, the security middleware computes the write-operation RLS filter and re-reads the target row with `{ id } AND <writeFilter>`; if the row isn't visible (someone else's, or RLS-hidden) it throws `PermissionDeniedError` (403). Reuses the existing RLS/tenant machinery, is recursion-safe (a `find` doesn't trigger the check), and is skipped when no RLS policy applies (e.g. admin sets, `modifyAllRecords`) so admins and unguarded objects are unchanged.
- **Repoint owner scoping to a column that exists.** `owner_only_writes`/`owner_only_deletes` keyed on `owner_id`, which author-defined objects almost never declare — so the policy referenced a missing column and `computeRlsFilter` dropped it (the no-op that made the bypass invisible). Now keyed on `created_by`, the ownership column the engine stamps on every object.

Result: a member may edit/delete the records they created, not others'; admins (and any set with `modifyAllRecords` or no RLS) are unrestricted. Objects that opt out of audit fields (`systemFields.audit: false`) have no `created_by` and now fail **closed** for member writes (grant `modifyAllRecords` or a per-object policy to allow). Objects modeling transferable ownership should override with a per-object owner policy.

Verified live on app-crm (2 users): member→others' record PATCH/DELETE = 403 (unmutated); member→own = 200; admin→any = 200. Note: cross-tenant write isolation additionally depends on an organization being assigned at sign-up (tracked separately in #1985).
