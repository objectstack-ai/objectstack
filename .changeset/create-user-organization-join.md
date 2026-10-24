---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(plugin-auth, platform-objects): Create User can add the new user to an organization in the same step

Clause-②: yes (widening: `POST /api/v1/auth/admin/create-user` accepts an optional `organizationId`; a request without it behaves exactly as before)
Metadata-protocol: none

In multi-org mode the membership reconciler binds no organization by itself (ADR-0093 D3: it never guesses one). So a user created from Setup had no membership, and the administrator had to open the organization's Members list and use Add Member as a second step.

- **The route.** `/admin/create-user` takes an optional `organizationId` (`organization_id` is also accepted). When one is given, better-auth's own `addMember` adds the user to that organization as `member`, the same act as Add Member. It runs inside the account's transaction, so an organization that does not exist, or a membership limit, refuses the call with the vendor's status and code, and no user is created. A membership already there is kept and reported as `membershipCreated: false`. The response and the audit row carry `organizationId` and `membershipCreated` as before.
- **Policy.** An organization the administrator names is an explicit flow, so `membershipPolicy: 'invite-only'` admits it, as it admits Add Member (ADR-0093 D1). The role is always `member`: to grant a higher role, use Change Role as before.
- **Capability.** A server without the organization plugin, or without a unit of work for the creation, answers `501` before any account exists.
- **The dialog.** Setup's Create User dialog gains an optional **Organization** picker (an inline lookup on `sys_organization`), shown only in multi-org mode (`features.multiOrgEnabled`). Single-org mode already adds every new user to the default organization, so it does not show the picker. `@objectstack/spec` records the param under `multiOrgEnabled.gatedInputs`.
