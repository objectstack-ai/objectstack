---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth)!: Copy Invite Link is no longer offered or answered for a pending invitation whose expiry has passed

Clause-②: no (narrowing) — the `sys_invitation.copy_invitation_link` handler refuses, `409 RESOURCE_CONFLICT`, an invitation that still reads `pending` after its `expires_at`, a call it answered before; the action's `visible` predicate hides it on such a row. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no metadata an author writes changes meaning: one platform action's handler narrows which rows it answers, and that action's own visible predicate follows it. The refusal is the handler's existing 409 RESOURCE_CONFLICT with a sentence naming expiry, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** row narrowing on `sys_invitation.copy_invitation_link` (`@objectstack/plugin-auth`, `@objectstack/platform-objects`).

- **The rule.** An expired invitation's link is no longer offered or answered. A row can still read `pending` after its `expires_at` has passed, because nothing moves it to `expired`; the handler now refuses it with `409 RESOURCE_CONFLICT`, as it refuses a non-pending row, and the row menu and record header no longer offer the action there. A missing or unreadable `expires_at` counts as expired.
- **Unchanged.** The other gates and their order (cloud-managed, the record, the caller, invite reach, pending), the link a pending invitation before its expiry answers, and Resend Invitation, which stays offered on an expired row.
- **Who sees it.** An organization admin who opens the row menu of an invitation past its expiry.

**The remedy.** Resend the invitation, then copy the link of the invitation Resend answers.
