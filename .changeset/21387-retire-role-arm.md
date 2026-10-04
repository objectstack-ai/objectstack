---
"@objectstack/plugin-approvals": minor
"@objectstack/spec": patch
---

fix(plugin-approvals)!: `role:<name>` is no longer a position address, and the deprecated `role` approver type stops writing `role:` slots (ADR-0090 D3)

Clause-②: no (narrowing)

`position:<name>` is now the one spelling of a position address. ADR-0090 D3 retired the word `role` with no alias window; the approvals service still read `role:<name>` as a second spelling of the same position everywhere it compares a slot with the caller ("My Pending", the participant gate, `viewer.can_act`, and the slot test of every decision). The stock console now sends `position:<name>`, so that arm is gone.

**FROM → TO.** FROM `role:<name>` → TO `position:<name>`, wherever a caller names a position: the `approverId` filter of `GET /api/v1/approvals/requests`, and the `actorId` of approve, reject, send back, reassign, request info and comment. A `role:<name>` ask now matches only a slot stored under that exact spelling, and a `role:<name>` actor is refused with 403 `FORBIDDEN` ("cannot act as …").

**The writer.** An approver authored with the deprecated type `{ type: 'role', value: … }` already resolved as `org_membership_level` (the org-membership tier: owner, admin, member). When that lookup found no one, the request's fallback slot kept the authored spelling, `role:<value>`, and a holder of a position with the same name decided it through the `role:` arm. That fallback now writes the canonical `org_membership_level:<value>`, so no path writes a `role:` slot. A stored slot is never rewritten.

Two classes of pending request are now decided only by an admin override:

- a request a 15.x-era release opened, whose slot is stored as `role:<name>`;
- a new request opened from a flow that still authors `{ type: 'role', value: '<a position name>' }` and whose membership-tier lookup finds no one (its slot is `org_membership_level:<name>`).

**Author's one-line fix:** write `{ type: 'position', value: '<the position>' }`. `os lint` already reports the old form as `approval-approver-not-membership-tier` or `approval-approver-type-deprecated`.

**Admin's one-line handling, both classes:** a platform admin (`admin_full_access`) or a tenant admin of the request's organization approves or rejects it (`POST /api/v1/approvals/requests/:id/approve` or `/reject`; recorded with `via_override: true`, and the flow run resumes), or reassigns it to the position's holder (`POST /api/v1/approvals/requests/:id/reassign` with `{ "to": "<user id>" }`), who then decides it normally.

<!-- adr-0087: registered approval-position-address-role-retired -->
