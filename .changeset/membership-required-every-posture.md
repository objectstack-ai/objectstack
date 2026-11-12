---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(security)!: a person's data access requires a current membership in the organization, under every tenancy posture

Clause-②: yes (narrowing) — data access narrows under the `single` posture to people who hold a current membership in the organization, as it already was under `isolated` and `group`; `@objectstack/core` gains one export, `isOutsideEveryOrganization`, and the optional `TenantLayer0Input.outsideEveryOrganization` input.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape. The rule is enforced at request time by the authorization resolver and the Layer 0 verdict, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — under every tenancy posture, a person's data access requires a current membership in the organization, judged on each request (ADR-0093 D8.1, as amended 2026-11-11).

**Migration note.** After the upgrade, a person without a current membership no longer reads or writes the organization's data in any posture, `single` included. Their reads of the organization's records resolve to nothing, and their writes are refused with `403 PERMISSION_DENIED` — the answers the `isolated` and `group` postures already gave. To give someone access, make them a member of the organization.

- Before upgrading a single-organization deployment, compare its users with its members (Setup → Members, or `sys_user` against `sys_member`) and add every person who should keep access. Under the default `auto` policy a user is bound to the default organization when created, but that bind is best-effort, and the membership backfill (ADR-0093 D6) runs once per deployment and does nothing on any later boot or seed. So these people can hold no membership: a user whose creation-time bind failed; a user an app's seed data inserted after the backfill ran; users created under `membershipPolicy: 'invite-only'` (also after a later switch to `auto`); every pre-existing member-less user of a deployment that set `OS_SKIP_MEMBERSHIP_BACKFILL=1`; and people removed from the organization. Add them with an invitation or `POST /api/v1/auth/organization/add-member` (platform administrator), at the grade that fits — end-users who are not teammates take the `external` tier.
- A flow that runs as the user, and a hook that runs as the user, are judged by the same rule as that user's own request.
- An API key is its owner's credential: it follows its owner's membership in the key's organization, under every posture.
- A delegated (on-behalf-of) operation runs in an organization only while the delegator holds a current membership there, under every posture.
- Unchanged: system contexts; platform operators (platform standing is the deployment's, not a membership's); a person's own account, session and invitation flows, and every object that is outside tenancy.

`vetOrganizationClaim` (`@objectstack/core`) applies the same rule under every posture; its third parameter, the tenancy posture, is deprecated and no longer read.
