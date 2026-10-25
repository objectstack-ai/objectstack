---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): in multi-org mode, Create User adds the new user to the administrator's current organization

Clause-②: yes (narrowing): under a walled posture `POST /api/v1/auth/admin/create-user` now refuses `400 NO_ACTIVE_ORGANIZATION` when the calling administrator has no current organization, where it used to create a member-less account; a request from an administrator in an organization now also adds the new user to it (widening)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is one admin route's answer for an administrator who has no current organization under a walled posture; the caller's migration is the one the refusal names: switch to an organization, then create the user. -->

**BREAKING** — under a walled tenancy posture (`group` / `isolated`), `/admin/create-user` no longer creates a user with no organization. The administrator's current (active) organization is the new user's organization, the way mainstream admin consoles add people to the workspace you are standing in. ADR-0093 D3 gains an amendment for this one route.

- **The join.** The new user joins the calling administrator's current organization as `member`, through better-auth's own `addMember`, the same act as Add Member, inside the account's transaction. A refused join (a membership limit) refuses the call with the vendor's status and code, and no user is created. A membership already there is kept and reported as `membershipCreated: false`. The response and the audit row carry `organizationId` and `membershipCreated` as before.
- **No choice to make.** The dialog and the route take no organization. To add a user to another organization, switch to it first.
- **No current organization.** FROM a member-less account TO `400 NO_ACTIVE_ORGANIZATION`, before any account exists. The fix is to switch to the organization the user belongs to, then create them.
- **Policy.** Under `membershipPolicy: 'invite-only'` the user still joins: creating a user inside your organization is an explicit act, like Add Member (ADR-0093 D1).
- **Capability.** A walled server without the organization plugin, or without a unit of work for the creation, answers `501` before any account exists.
- **Unchanged.** The `single` posture (a degraded wall included), self sign-up, bulk import, SSO sign-in and invitations.
