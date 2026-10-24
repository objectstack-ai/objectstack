---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): reassigning an approval to an address that resolves to no one is refused, instead of stranding the request on a slate nobody can decide

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is which `to` the runtime reassign door accepts in its request body. -->

**BREAKING** for a caller of `POST /api/v1/approvals/requests/:id/reassign` (or `ApprovalService.reassign`) that names a `to` no one can take.

- **What is refused.** FROM: any non-empty `to` that was not already pending was written onto the slate and answered 200, so `{"to":"usr_does_not_exist"}` left the request waiting on nobody until an override actor moved it again. TO: `to` must resolve in the request's organization, or the call answers `400 VALIDATION_FAILED` naming the address, and the slate, the audit trail and the notifications are unchanged:
  - a user id or an email: a user account carries it (the email as the account stores it), and that user is not a member of other organizations only;
  - `position:<name>`: someone holds that position in the request's organization;
  - any other `type:value` address (`team:`, `department:`, `org_membership_level:`, a stored `role:`): never, because no approver acts under it.
- **Who is affected.** Every caller of the door, the admin rescue of a request whose slate names no one included. A missing user and a user of another organization get the same refusal text, so the answer does not reveal who exists elsewhere.
- **Unchanged.** A caller who may not move the slot is still refused `403 FORBIDDEN` first, before any directory read. An empty `to`, and a `to` that is already pending, are refused as before. The SLA escalation `reassign` action is not this door and is unchanged.

**What a caller does.** Reassign to the user id or email of a person in the request's organization, or to `position:<name>` for a position someone in it holds.
