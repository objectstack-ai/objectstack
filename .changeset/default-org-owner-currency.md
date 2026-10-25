---
'@objectstack/plugin-auth': patch
---

Clause-②: no
Metadata-protocol: none

The single posture's Default Organization now takes its first owner's default currency. That organization is created at boot with no creator, so it never passed through organization creation, and a new self-hosted install showed code-less amounts as plain numbers until an administrator set Setup → Localization → Default currency by hand. When the default-organization bootstrap first binds (or promotes) its owner, the organization gets `localization.currency` by the same rule a new organization's creator gets: the owner's stored `sys_user.locale`, else the binding request's `Accept-Language` (on a first sign-up, the sign-up request), mapped through the CLDR region table. Nothing derivable means nothing is written, and a value already set on any rung is never overwritten. `EnsureDefaultOrganizationResult` gains an optional `ownerUserId`, set when the call bound or promoted the owner.
