---
'@objectstack/platform-objects': patch
---

feat(platform-objects): the platform identity actions an agent may reach declare it — additive acts exposed, destructive lifecycle acts exposed behind confirmation, credential and ownership acts human-only

Clause-②: no
Metadata-protocol: none

The `sys_*` identity objects' actions now carry the ADR-0011 `ai` block by risk, as ADR-0011's 2026-10-30 addendum records (58 actions assessed, 38 declared):

- **Exposed (21).** Additive or self-scoped acts declare `ai: { exposed: true, description }`: the four `invite_user` mirrors, resending and accepting an invitation, adding a member to an organization or a team, creating, editing and renaming a team or an organization, switching the active organization, re-enabling an OAuth application, enabling two-factor authentication, updating your own profile, resending the verification email, and requesting SSO domain verification.
- **Exposed, confirmation required (17).** Destructive or privilege-changing lifecycle acts also declare `requiresConfirmation: true`, so MCP `run_action` refuses them `428 ACTION_CONFIRMATION_REQUIRED`, with nothing run, until the call carries `confirm: true`: banning, unbanning and unlocking a user, setting a user's manager, revoking an API key or a session, signing out other devices, cancelling or declining an invitation, removing a member or a team member, deleting a team, an OAuth application or an SSO provider, disabling an OAuth application, leaving an organization, and unlinking a sign-in provider.
- **Human-only (20).** Acts that mint a credential or a session, change ownership, a role or a sign-in factor, or destroy an account or an organization (impersonating a user, setting a password, creating a user or an API key, transferring ownership, changing a member's role, deleting an organization, and the rest the addendum names) declare no `ai` block and are not listed over MCP. `sys_invitation.copy_invitation_link` declares none either; it was not part of the assessment.

Over MCP these actions are listed and run behind every existing gate: the capability gate, the installation's action switch, the param contract, the confirmation gate and the identity route's own authorization. They are `type: 'api'` actions forwarded to identity routes that accept a signed-in session only, so an agent connected over OAuth sees them listed and is refused at the route when it runs one.
