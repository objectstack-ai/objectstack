---
'@objectstack/platform-objects': patch
'@objectstack/plugin-sharing': patch
'@objectstack/spec': patch
---

fix: Setup forms show option labels instead of machine values on Business Units, Sharing Rules and Datasources

Clause-②: no
Metadata-protocol: none

- **`@objectstack/platform-objects`:** `sys_business_unit.kind` declared its options as bare strings, so each label equalled its stored value and the form offered `cost_center`. The options now carry labels (Company, Division, Department, Office, Cost Center). The stored values are unchanged.
- **`@objectstack/plugin-sharing`:** `sys_sharing_rule.recipient_type` and `access_level` declared bare-string options too. They now carry labels (User, Team, Business unit, Position, Business unit and subordinates, Field; Read, Read and edit), which are the names the Recipient Type help text already used. `sys_record_share` declares the same recipient and access vocabulary, so its `recipient_type` (User, Group, Position, Business unit and subordinates) and `access_level` options carry the same labels. The stored values are unchanged.
- **`@objectstack/spec`:** the `autoMigrate` key of the SQLite, PostgreSQL and MySQL driver configs had no JSON-Schema `title`, so the New datasource form labelled the field with the raw key `autoMigrate`. It is now titled "Auto-migrate schema".

The English labels flow into the generated translation bundles; the existing zh-CN, ja-JP and es-ES option translations are kept.
