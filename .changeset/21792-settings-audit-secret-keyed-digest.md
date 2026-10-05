---
'@objectstack/service-settings': patch
'@objectstack/spec': patch
---

The settings audit trail records a secret-valued setting (an encrypted key) with the crypto provider's keyed digest, never an unkeyed one (#21792).

Clause-②: no

- **Both ledgers.** The `sys_audit_log` `config_change` row (`valueDigest`, spelled `<encrypted:hmac-sha256:…>`) and the `sys_setting_audit` row (`new_hash`) now carry `ICryptoProvider.keyedDigest(value)` for a secret-valued setting. Before, they carried the unkeyed `digest` (`sha256:…`). This covers the `sys_secret` path and the legacy inline-adapter path.
- **Change detection still works.** The keyed digest is stable for equal values under one key, so the trail still shows whether a secret changed and whether it went back to an earlier value. Rotating the data key changes every later fingerprint. Rows written before this release keep their old `sha256:` value.
- **No keyed digest, no fingerprint.** When no crypto provider is wired (a host that builds `SettingsService` with only a `CryptoAdapter`), or the provider refuses a keyed digest, the audit rows record the write with no value fingerprint: `valueDigest` is `<encrypted>` and `new_hash` is null. The service logs this once per key at `warn`. The settings write itself is never refused for it. The adapter's own `digest` is no longer used for secrets.
- **Non-secret settings are unchanged.** They keep the adapter's `digest` of the canonical JSON.
- **Contract text (`@objectstack/spec`).** The `ICryptoProvider` docs for `digest` and `keyedDigest` now state the rule: a secret's audit fingerprint comes from `keyedDigest`, never from `digest`, and with no keyed digest the trail records none. No type, export or schema changes.
