---
'@objectstack/plugin-approvals': patch
---

A holder of a position whose approval slot reads `position:<name>` now decides it from the stock console, sees `can_act` on it, and keeps sight of it after deciding; a reviewer named by a `user` approver authored as an email does too

Clause-②: no

A request whose approver position nobody held when it opened keeps the literal `position:<name>` slot. After the position is staffed, its holder found the request in "My Pending", but `viewer.can_act` was `false`, an approve with no `actorId` (what the console's approve action sends) or with `role:<name>` (the deprecated pre-rename spelling the console uses) answered 403, only naming `position:<name>` decided it, and `GET /api/v1/approvals/requests/:id` then answered 404 to the holder who had just decided it. A `user` approver authored as an email had the same shape: its reviewer saw neither the request nor `can_act`, and only naming the email decided it.

Every place the approvals service compares a slot with the caller now reads the caller's acting addresses, the set its decision routes already admitted: the user id, the email the caller's own account carries, and both spellings of each position on the caller's server-resolved context.

- **Decisions** (approve, reject, send back, reassign, request info, comment): with no `actorId`, the caller takes the first pending slot keyed by one of those addresses, their user id first. A named `role:<name>` or `position:<name>` takes that position's slot under either spelling. Nobody new may decide: a user who holds another position is still refused with 403.
- **What is recorded:** `sys_approval_action.actor_id` holds the slot the action took, in that slot's stored spelling. That is what naming the slot always recorded, and the multi-approver tally counts approvals by matching it against the slate.
- **`viewer.can_act`** is computed by the same slot test the decision routes run with no `actorId`, so it is `true` exactly when such an approve would be admitted as a slot holder.
- **Visibility:** the participant gate counts a current approver by the email half too. "Already acted" is counted by the same addresses, so a request decided under `position:<name>` stays visible to whoever holds that position.

An admin who holds the routed position now decides it as a slot holder (`via_override: false`, one vote in a multi-approver tally), exactly as when they named the slot; an admin who holds no slot is unchanged.
