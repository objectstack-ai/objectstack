---
'@object-ui/permissions': patch
---

fix(permissions)!: the console stops offering New, Edit and Delete to a user whose `/me/permissions` row omits the Create, Edit or Delete bit, such as an auditor or a read-only finance user

Clause-②: yes (narrowing) — the console no longer offers Create / Edit / Delete when `/me/permissions` serves an object row that omits the bit. That is exactly when the server refuses it, because the spec grants only on `=== true` (permission.zod.ts:196, :218). The anonymous default and the no-provider fail-open are unchanged.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A console permission verdict: no key of any metadata schema is added, removed, renamed or re-shaped, and no export, type or error code changes. The client now reads a served row with the spec's own objectPermissionGrants, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** (a narrowing of what the console offers) in `MePermissionsProvider` (`@object-ui/permissions`).

- **Before.** `check` (behind `usePermissions().can`) and `checkField`'s object-level fallback read a served object row with `bit !== false`, so a bit the row left out counted as granted. The server serves only the bits a set grants: a read-only set `'*': { allowRead: true }` is served as `{ allowRead: true }` on each object it covers, and an auditor's row as `{ allowRead: true, viewAllRecords: true }`. Those users were offered New on object lists, and Edit and Delete on records. They filled in the form, and the server refused the save with `403`.
- **Now.** A served row grants an operation only through `objectPermissionGrants` from `@objectstack/spec/security`, the fold the server's permission evaluator decides from. A bit grants only when it is `true`. Modify All Records also grants edit, delete and transfer, and View All Records also grants read. Nothing grants create but `allowCreate: true`. `check` also matches the object key case-insensitively, as `checkField` already did.
- **Unchanged.** An anonymous session (`authenticated` not `true`) keeps its permissive default. A tree with no permission provider keeps the fail-open `can`. An object the response does not mention is still denied for a signed-in user. A row that carries the bit as `true` grants exactly as before.
- **Who sees it.** A user whose permission sets grant read but not Create, Edit or Delete on an object. The console now hides or disables those actions, matching the server's answer. A user whose sets grant the bit sees no change.
