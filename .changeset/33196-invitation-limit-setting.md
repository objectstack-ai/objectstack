---
'@objectstack/plugin-auth': patch
'@objectstack/types': patch
---

feat(plugin-auth): the organization's pending-invitation limit is a host setting, `OS_ORG_INVITATION_LIMIT`, that can be turned off

Clause-②: yes (widening)
Metadata-protocol: none

An organization could hold at most 100 pending invitations: the auth library refuses the next one with `403 INVITATION_LIMIT_REACHED` when no limit is configured, and nothing configured one. A host can now set it with `OS_ORG_INVITATION_LIMIT`: a positive integer is the limit, and `off`, `unlimited` or `none` removes it, for a host that invites people in bulk. Unset, `0` or an unparsable value keeps today's limit of 100, so a deployment that sets nothing behaves exactly as before. `@objectstack/types` adds `resolveOrgInvitationLimit()` beside `resolveOrgMembershipLimit()`.
