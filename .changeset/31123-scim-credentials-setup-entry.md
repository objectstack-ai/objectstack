---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth): a "SCIM Credentials" entry in Setup > Access Control while SCIM is wired

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/plugin-auth`** contributes a Setup navigation entry `nav_scim_credentials` ("SCIM Credentials") that opens `sys_scim_connection_credential`, the object the console's Mint Credential and Revoke Credential actions live on. It sits in the Access Control group after SSO Providers and carries the same gate (`manage_platform_settings`). It is contributed only while SCIM is wired, decided by `isScimWired()`, the same answer the `/admin/scim/mint-credential` door reads before it refuses 503, so the entry never opens a list whose Mint button can only fail. The mint and revoke doors keep their own platform-admin gate; the entry widens nothing. The SSO Providers entry is unchanged, and a deployment with neither SSO nor SCIM wired gets no plugin-auth Setup entry, as before.
- **`@objectstack/platform-objects`** adds the label `apps.setup.navigation.nav_scim_credentials` to the Setup app's translation bundle in en, zh-CN, ja-JP, es-ES, zh-Hant and ar (a new published key, hence the widening arm).
