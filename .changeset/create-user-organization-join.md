---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(plugin-auth, platform-objects): in multi-org mode, Create User adds the new user to an organization in the same step, by default the administrator's current one

Clause-②: yes (widening: `POST /api/v1/auth/admin/create-user` accepts an optional `organizationId`, and in multi-org mode a request without one joins the administrator's current organization; single-org creation is unchanged)
Metadata-protocol: none

In multi-org mode a user created from Setup had no membership, so the administrator had to open the organization's Members list and use Add Member as a second step, every time. ADR-0093 D3 gains an amendment for this one endpoint.

- **The dialog.** Setup's Create User dialog gains an optional **Organization** picker, shown only in multi-org mode (`features.multiOrgEnabled`). Left empty, the new user joins your current organization. Choose another organization to put them there instead.
- **The route.** `/admin/create-user` takes an optional `organizationId` (`organization_id` is also accepted). Which organization the user joins:

  | Request | Joins |
  |:---|:---|
  | `organizationId` given | that organization |
  | omitted, multi-org, policy `auto` | the calling administrator's current (active) organization; none when they have none |
  | omitted, single-org (a degraded wall included) | unchanged: the default organization, as before |
  | omitted, policy `invite-only` | none, as before |

  The user joins as `member` through better-auth's own `addMember`, the same act as Add Member, inside the account's transaction. So a refused join (an organization that does not exist, a membership limit) refuses the call with the vendor's status and code, and no user is created. A membership already there is kept and reported as `membershipCreated: false`. The response and the audit row carry `organizationId` and `membershipCreated` as before. To grant a higher role, use Change Role as before.
- **Policy.** An organization the administrator names is an explicit flow, so `membershipPolicy: 'invite-only'` admits it, as it admits Add Member (ADR-0093 D1). A default is not an explicit choice, so `invite-only` applies no default.
- **Capability.** A server without the organization plugin, or without a unit of work for the creation, answers `501` to a request that names an organization, before any account exists. With nothing named, it creates the user without a membership, as before.
- **Unchanged.** Single-org creation, self sign-up, bulk import, SSO sign-in and invitations. `@objectstack/spec` records the new param under `multiOrgEnabled.gatedInputs`.
