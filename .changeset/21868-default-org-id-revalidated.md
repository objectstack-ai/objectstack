---
'@objectstack/plugin-auth': patch
---

A user created after the default organization is deleted and recreated in the same process is now bound to the organization that exists, not to the deleted one's id.

Clause-②: no

- **What was wrong.** The `tenancy` service's `defaultOrgId()` memoized the default organization id for the life of the process and never checked it again. The single-org bootstrap recreates a missing `slug='default'` organization on the next `sys_user` write, under a new id. Users created under the `auto` membership policy after that were bound to the deleted id. Membership is decided once, at creation (ADR-0093 D7), so nothing repaired them later.
- **What changed.** Every call checks the memoized id against `sys_organization` with one read by primary key. If the organization still exists, it is returned and nothing is re-resolved. If it is gone, the id is resolved again by the same rule that set it (the `slug='default'` organization first, else the only organization), so the replacement is the one a fresh boot would pick. If none exists yet, the answer is `null`, and the next call resolves again.
- **A read the store cannot answer** (a failed read, or a reply that is not a row list) keeps the memoized id. It is not treated as proof that the organization is gone, because that would bind the next user to no organization at all.
- **Who sees it.** Every reader of `defaultOrgId()` gets the check: the membership bind at user creation and its first-session settle, the self-registration grant, the admin create-user path, the membership backfill, the anonymous public form doors and the check on organization-scoped form writes, and the email-template bootstrap. Each call with a memoized id costs one primary-key read of `sys_organization`.
- No public export, option or accepted input changes. Walled postures still answer `null` without reading anything.
