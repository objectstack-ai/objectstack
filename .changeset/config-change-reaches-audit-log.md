---
"@objectstack/service-settings": patch
---

fix(service-settings): settings writes reach `sys_audit_log` as `config_change` (#8145)

`GET /api/v1/data/sys_audit_log?$filter={"action":"config_change"}` answered
**total 0** after any settings write, for the whole life of that enum member. So
did the shipped `config_changes` list view and the console filter that offers the
value: three surfaces advertising a class of audit event the platform never
recorded. A settings change was audited — into `sys_setting_audit`, with
`action: 'set'` — and nowhere else, while the settings service's own type
documentation promised `sys_audit_log` rows "for every successful write".

The cause was one argument. `SettingsAuditSink` — the slot documented since
Phase 3 as the one that writes the generic ledger — is the second parameter of
`SettingsService.bindEngine`, and `SettingsServicePlugin` passed `undefined`
there. Nothing else was missing: the service called the sink on every write, the
enum declared the value, the view filtered on it.

**Both ledgers are written now** (the dual-write half of the 2026-08-12 ruling on
#7675, which left the choice to the implementation):

- `sys_audit_log`, `action: 'config_change'` — the platform-wide compliance
  ledger. One row per changed key, attributed on `user_id` and `actor`, stamped
  with the caller's tenant (and `organization_id` where the deployment declares
  it, without which RLS would hide every row and leave the view as empty as
  before). `metadata` carries the namespace/key/scope and whether the key is
  encrypted; `new_value` carries a **digest**, never a value.
- `sys_setting_audit`, `action: 'set' | 'reset'` — unchanged. It keeps its rows
  because it has live readers and because it records what the generic ledger has
  no columns for (`namespace`, `key`, `scope`, `old_hash`/`new_hash`, `source`,
  `reason`).

The new write is **best-effort and can never fail a settings write**:
`sys_audit_log` belongs to the optional `@objectstack/plugin-audit`, so on a
deployment without that plugin the table does not exist, and the sink reports the
gap once per process rather than raising. A write that is REFUSED — an
unauthorised caller, an env-pinned key, the #8026 fail-closed crypto refusal —
still emits no row on either ledger: a refused write is not a successful one, and
a ledger listing configuration changes that never happened would be a worse lie
than the empty view.

`settings-service.types.ts`'s contract line now states what is built rather than
what was intended, per the ruling's 以实现定契约.
