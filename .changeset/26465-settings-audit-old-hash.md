---
'@objectstack/service-settings': patch
---

fix(service-settings): the settings audit trail records the previous value's digest in `old_hash`, and a non-secret value's digest is the declared SHA-256

Clause-②: no
Metadata-protocol: none

`sys_setting_audit` and `sys_platform_setting_audit` declare `old_hash` as the SHA-256 of the previous value (null when it was unset) and `new_hash` as the SHA-256 of the new value (null on a reset). The write path passed `old_hash: null` on every write and recorded the adapter's FNV-1a 32 (`fnv32:…`) as the new hash, so an operator could not tell from the trail whether a write changed anything.

- **`old_hash`** now holds the digest of the value the row held before the write, read off the row the upsert already looks up: no extra read, and none at all for a first write. It is null for a first write, after a reset, and for a row that held a secret.
- **A non-secret value's digest** is now `sha256:` followed by the hex SHA-256 of its canonical JSON, on both `new_hash` and the `config_change` row's digest in `sys_audit_log`. It no longer goes through `CryptoAdapter.digest`, so an injected adapter cannot change the format. The prefix keeps it distinct from the `fnv32:` rows already stored, which are left as they are: compare hashes only between rows that carry the same prefix.
- **Secret values are unchanged.** They keep the crypto provider's keyed digest (`hmac-sha256:…`) as `new_hash`, or none, and `old_hash` stays null for them.
