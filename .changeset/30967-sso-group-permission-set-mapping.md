---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth): an SSO sign-in grants the ordinary permission set its IdP group is mapped to

Clause-②: yes (widening)
Metadata-protocol: none

An enterprise SSO provider (OIDC or SAML, through `@better-auth/sso`) can now drive what its users may do from the groups the identity provider sends at sign-in, through the same `sys_idp_group_mapping` mappings a SCIM connection uses. There is no second mapping model.

- **Where the groups come from.** Set the provider's own claim mapping to fill `groups`: `mapping.extraFields: { groups: 'groups' }` for an OIDC claim named `groups`, or the attribute name an IdP uses for SAML (for example Entra ID's groups claim URI). The value may be one string or a list of strings. A provider whose mapping fills no `groups` behaves as before.
- **Saving a mapping.** `POST /api/v1/auth/admin/scim/set-group-mapping` now also takes `providerId` in place of `connectionId` (exactly one of the two; both is `400 VALIDATION_FAILED` on `providerId`). The grant's organization is the provider's own `organization_id`; a provider that names none, or an unknown provider, is refused `400 VALIDATION_FAILED` on `providerId`. With SSO off the save is refused `503`. The same platform-admin gate and the same organization-boundary judgement apply: administrator sets and every set outside the organization boundary are refused, and without a security service the save is refused `503`. The row is stored with `source_kind: 'sso'` (a new option on `sys_idp_group_mapping.source_kind`) and `source_id` = the provider id.
- **At each sign-in.** Every sign-in through the provider matches each group value against the provider's mappings (by `groupExternalId` when the mapping names one, which suits Entra ID's group object ids, else by exact `groupDisplayName`) and makes the user's grants follow them: a mapped group grants its set in the provider's organization, and a group the user has left loses the set at their next sign-in. A sign-in with no groups removes the grants that provider made earlier. The boundary is asked again before every grant, so a set that becomes an administrator set after its mapping was saved grants nothing, and with no security service nothing is granted. Only grants the provider made (their `reason` names the provider) are ever removed: a grant made by hand, or by SCIM, is never touched. Every write goes through the engine, so the break-glass last-administrator guard still refuses what it refuses elsewhere. If applying the mappings fails, the sign-in still succeeds and the failure is logged at `error`.
- **Deleting a mapping.** `POST /api/v1/auth/admin/scim/delete-group-mapping` removes an SSO mapping and, at once, the grants its provider made of that set in that organization, unless another of the provider's mappings still names that set (then each user's next sign-in decides).
