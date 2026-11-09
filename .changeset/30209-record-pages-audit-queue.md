---
'@objectstack/service-settings': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-sharing': patch
---

feat(service-settings,plugin-audit,plugin-sharing): a config_change ledger row names the settings row it changed, an audit row's record page lists the other changes to the same record, and a queue's record page lists its members

Clause-②: no
Metadata-protocol: none

- **`@objectstack/service-settings`: the `config_change` row's shape changes (not breaking).** A settings write's `config_change` row in `sys_audit_log` now sets `record_id` to the id of the stored settings row the write changed (`sys_setting`, or `sys_platform_setting` for a global value), beside the `object_name` it already named; before, `record_id` was always null. `metadata` and the digest in `new_value` are unchanged, and an in-memory settings store still writes null. Rows written before this release keep their null `record_id`.
- **Who can read those rows narrows.** Because a `config_change` row now names a record, the ledger's parent-record read gate judges it by that settings row: a reader holding only the ledger's own read grant, who cannot read the settings store, no longer sees new `config_change` rows. Holders of the ledger's audit capability (`view_all_audit_log`, administrators by default) still see every row. Older rows with a null `record_id` are still served under the ledger grant. Nothing becomes visible to a reader who could not see it before.
- **`@objectstack/plugin-audit`: `sys_audit_log` gets a default record page** (`sys_audit_log_detail`) that shows the row's fields and lists every other ledger row with the same `record_id`, newest first. Beside a `config_change` row that list holds the CRUD mirror's create and update rows for the same settings row, which carry a non-secret value in plain text; a secret's mirror row carries neither the value nor its handle. The list has no "New". The page label ships in all eleven locales.
- **`@objectstack/plugin-sharing`: `sys_queue` gets a default record page** (`sys_queue_detail`) whose members list reads `sys_queue_member` where `queue` equals this queue's `name`, and whose "New" opens the member form with `queue` filled in with that name. `sys_queue_member.queue` is unchanged. Declared queues have no `sys_queue` row, so they have no page. The page label ships in the plugin's four locales.
