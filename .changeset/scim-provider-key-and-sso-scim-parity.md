---
"@objectstack/platform-objects": patch
---

fix(auth): provision `sys_scim_provider.provider_key` — SCIM provider creation failed the moment SCIM was switched on (#3653)

`@better-auth/scim` declares `providerKey` as `required: true, unique: true`
and writes it on every provider insert — a derived `<organization>:<provider_id>`
uniqueness key it owns end to end. `sys_scim_provider` never provisioned the
column, so the adapter emitted a `provider_key` no table had: the same failure
shape as #3624, waiting behind the `OS_SCIM_ENABLED` flag.

Found by extending the better-auth parity gate to `@better-auth/sso` and
`@better-auth/scim`. Neither accepts a `schema` option, so `getAuthTables()` is
blind to them and they were excluded when that gate shipped; the gate now reads
each plugin's own declared schema and resolves columns the way the adapter
actually does for a bridged model. `@better-auth/sso` came back fully covered.

Existing environments pick the column up through the driver's additive schema
sync; it stays null on pre-upgrade rows, which the nullable UNIQUE index admits.
