---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a user preference's owner is fixed when the preference is saved

Clause-②: no (narrowing) — a non-system update of a `sys_user_preference` row that sends a `user_id` other than the stored one is refused `403 PERMISSION_DENIED`, which some callers' writes were admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a save rule on one platform object refuses a change of the row's owner. The refusal is a 403 a caller cannot work around by rewriting metadata, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the generic data door for `sys_user_preference` (`@objectstack/plugin-auth`).

- **Now.** A preference belongs to the user it was saved for. An update that sends a different `user_id` is refused `403 PERMISSION_DENIED`, for every caller but the system: a member, an organization administrator and a platform administrator alike. The refusal names the row and the `user_id` column. The row is unchanged.
- **Unchanged.** An update that echoes the stored `user_id`, or does not send it, saves as before. The console's preference writer updates `value` only and creates rows in the caller's own name, so it is not affected. A system write (the platform's own writers) is not judged.
- **Shared rule.** `sys_personal_view` and `sys_user_preference` now hold this with one check, `owner-fixed-rule.ts`. The personal view's behaviour and message are unchanged.
- **Who sees it.** A client that changes the `user_id` of a saved preference.

**The remedy.** Save a new preference in the other user's name, as that user, instead of moving one.
