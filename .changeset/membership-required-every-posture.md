---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
---

fix(security)!: a person's data access requires a current membership in the organization, under every tenancy posture

Clause-②: yes (narrowing) — data access narrows under the `single` posture to people who hold a current membership in the organization, as it already was under `isolated` and `group`; `@objectstack/core` gains one export, `isOutsideEveryOrganization`, and the optional `TenantLayer0Input.outsideEveryOrganization` input.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape. The rule is enforced at request time by the authorization resolver and the Layer 0 verdict, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — under every tenancy posture, a person's data access requires a current membership in the organization, judged on each request (ADR-0093 D8.1, as amended 2026-11-11).

**Migration note.** After the upgrade, a person without a current membership no longer reads or writes the organization's data in any posture, `single` included. Their reads of the organization's records resolve to nothing, and their writes are refused with `403 PERMISSION_DENIED` naming the missing active organization — the answers the `isolated` and `group` postures already gave. To give someone access, make them a member of the organization.

- Single-organization deployments that keep the default membership backfill (ADR-0093 D6) need no action: every user is bound to the default organization when they are created and when seed data settles. A deployment that turned it off (`OS_SKIP_MEMBERSHIP_BACKFILL=1`, or `membershipPolicy: 'invite-only'`) gives each person who should reach the data a membership through the member admin screens.
- An API key is its owner's credential: it follows its owner's membership in the key's organization, under every posture.
- A delegated (on-behalf-of) operation runs in an organization only while the delegator holds a current membership there, under every posture.
- Unchanged: system contexts; platform operators (platform standing is the deployment's, not a membership's); a person's own account, session and invitation flows, and every object that is outside tenancy.

`vetOrganizationClaim` (`@objectstack/core`) applies the same rule under every posture; its third parameter, the tenancy posture, is deprecated and no longer read.
