---
'@objectstack/service-settings': patch
'@objectstack/plugin-audit': patch
---

fix(service-settings): a settings `config_change` audit row records the value before and after the change, with secrets kept as digests

Clause-②: yes (widening)
Metadata-protocol: none

A settings write's `config_change` row on `sys_audit_log` recorded who changed which key and when, plus a digest of the new value. It had no `old_value`, and its `new_value` held no readable value, so the row could not show what a policy setting (for example `auth.allowed_ip_ranges`) was changed from or to. ADR-0007 (Audit & history) asks for both, with an encrypted value recorded only as a placeholder and a checksum.

- **`@objectstack/service-settings`.** `new_value` is `{ namespace, key, scope, value, digest }`. `old_value` has the same shape for the value the same stored settings row held before the write. It is `null` when that row held no value: a first write at that scope, or a row an earlier reset cleared. A reset now records its before value in `old_value`, and its `new_value` stays `null`. A secret-valued key, which is one the manifest declares `encrypted: true` (`type: 'password'` forces it), carries no `value` on either side. Each side carries only its masked digest, `<encrypted:hmac-sha256:…>`, or `<encrypted>` when no keyed digest is available. That is the same `new_value` such rows had before, so readers that parse it keep working. A row stored encrypted is never shown either, even if the key is no longer declared secret. `metadata` is unchanged and carries no value. `SettingsAuditSink.record` gets two optional entry fields, `value` and `previous`, and a host sink that ignores them works as before.
- **`@objectstack/plugin-audit`.** The ledger's read-side field redaction now also applies to a `config_change` row about a settings store (`sys_setting`, or `sys_platform_setting` for a global value). If a reader's field-level security masks that store's `value` field, the reader gets neither the value nor its digest on either side. They still see which setting changed. The CRUD mirror's row about the same write is narrowed the same way. Readers who can see the field get the row exactly as stored.
