---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a position assignment or permission-set grant scoped to an organization must name a member of that organization

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door: a non-system insert or update of a sys_user_position or sys_user_permission_set row whose user holds no sys_member row in the row's organization is refused with the existing 400 VALIDATION_FAILED envelope. The other categories are closed on facts: the one bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and nothing exported is removed or narrowed, so it is neither runtime-interface-only nor type-surface-only. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**What stops being accepted.** A `sys_user_position` or `sys_user_permission_set` row whose `organization_id` is set may name only a user who holds a `sys_member` row in that organization. A non-system insert or update that would store any other user is refused with `400 VALIDATION_FAILED`, one `fields[]` entry at `user_id` with `code: reference_not_found` — the envelope a `user_id` naming no user already receives. No new error code. It applies to every non-system caller, platform administrators included, and to every engine write: `POST` / `PATCH /api/v1/data/...`, batch inserts, predicate updates, and scripts and flows that run as a user or a service principal. The organization judged is the one the row is stored with: its own `organization_id`, or, when it names none, the caller's active organization stamped at write time.

**What stays accepted.**

- System-context writes: seed replay, invitation acceptance, the organization-admin reconcile and the platform bootstraps.
- A row stored with no organization: a global grant names no organization to be a member of.
- An update that changes neither `user_id` nor `organization_id`, so a stored row whose holder has since left the organization stays editable and can be end-dated.
- A stock `single`-posture deployment: under the default `auto` membership policy every user is a member of the default organization, so every assignment there names a member.

**What changes for you.** Add the user to the organization first, then assign the position or grant the permission set. A script that assigned a grant before the user joined now receives the `400` above; reorder it.
