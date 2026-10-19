---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the self-registration grant settles on the registrant's first membership, owned by that organization (ADR-0131 D3)

Clause-②: no

The declared self-registration permission set (`auth.audience.selfRegistrationPermissionSet`) is an assignment, and an assignment is an organization row (ADR-0131 D3). It is now written with the registrant's first membership and owned by that membership's organization, under every posture. It is never written without an organization.

- **`single`: unchanged.** The membership reconciler binds the Default Organization in the same `user.create.after` hook, so a sign-up still ends with one grant, owned by the Default Organization.
- **A wall (`group`, `isolated`).** A self-registrant belongs to no organization at sign-up, so the sign-up writes no `sys_user_permission_set` row. It used to write one with no organization. The grant is held as a pending claim in `sys_verification`, which is deployment-level and survives a restart. The first `sys_member` row written for the user lands exactly one grant, owned by that organization. That row can come from creating an organization (the creator becomes its owner), accepting an invitation, being added by an administrator, or any other membership writer. A later membership writes no second grant.
- **The claim waits 365 days.** A registrant who first joins an organization after that holds only the deployment's baseline. An engine with no middleware seam cannot settle a claim, so there a registrant with no organization is reported ungranted at `error` at sign-up instead.
- Grants already written without an organization by earlier walled sign-ups are not touched here.
