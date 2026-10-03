---
'@objectstack/plugin-approvals': patch
---

An approval action now records the user who took it in `sys_approval_action.actor_id`, and the pending-approver slot it was taken as in a new `acted_as` column; rows stored before this move their slot out of `actor_id` at the next boot

Clause-②: no

`actor_id` is a lookup to `sys_user`, so under ADR-0118 D1 it holds a user id or nothing. A slot-gated action used to record the slot it took there instead: a `position:<name>` literal for a position staffed after the request opened, or an email for a `user` approver authored as one. On those decisions no record named the person who decided. The audit ledger and activity rows the write produces carry no user, so the attribution was lost, and every join or report on the lookup silently dropped the row.

**This supersedes the "What is recorded" sentence of the unreleased `21379-position-address-readers` changeset**, which says `actor_id` holds the slot. From this release it holds the person.

- **What is recorded.**
  - `actor_id` is the user the request's context vouches for: the signed-in caller, whatever address they named.
  - `acted_as` is the slot the action took, in the slot's stored spelling (a user id, an email, or `position:<name>`). It is empty on actions no slot admitted: the submitter's own actions, system actions, and an admin override, which `via_override` still marks.
  - An emailed action link records the one account that carries the token's email. If no account carries it, the link records no person.
  - The SLA sweep keeps its reserved `system:sla` actor for now.
- **What reads it.**
  - The multi-approver tally and `decision_progress` count `acted_as`.
  - A participant who already acted keeps sight of a request by either of two facts: `actor_id` is their user id, or `acted_as` is a slot they act under (so a decision taken as `position:<name>` stays visible to that position's holders).
  - Nothing compares a slot with `actor_id` any more.
  - The action log (`GET /api/v1/approvals/requests/:id/actions`, `listActions`) returns `acted_as` beside `actor_id` and `actor_name`, filling the `ApprovalActionRow.acted_as` member `@objectstack/spec` declares. It is omitted when the action took no slot, or when no stored record kept the slot.
- **Stored rows.** A repair runs on every boot and is idempotent.
  - Pass 1: a row whose `actor_id` still holds a slot address gets `acted_as` set to it and `actor_id` cleared. No stored record names who decided it, so it shows the slot and no person.
  - Pass 2: the approve votes a still-pending request's tally counts get their `acted_as`, so in-flight `unanimous`, `quorum` and `per_group` requests keep the approvals they already collected.
  - A failure is logged at error level and retried at the next boot.
- **For a report or integration that read `actor_id` as the slot:** read `acted_as` instead. `actor_id` now always joins to `sys_user`.
