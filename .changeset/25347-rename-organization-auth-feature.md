---
'@objectstack/spec': patch
---

feat(spec): `PUBLIC_AUTH_FEATURES` books Rename Organization under the organization capability

Clause-②: yes
Metadata-protocol: none

The `sys_organization.actions.rename_organization` row moves from `multiOrgEnabled.gatedInputs` to `organization.gatedInputs`, matching the action's new `requiresFeature: 'organization'` in `@objectstack/platform-objects`. A `single` deployment, where `multiOrgEnabled` is false and the organization capability is on, now offers it. No other row moves.

Ruling 6384629949 on #25347.
