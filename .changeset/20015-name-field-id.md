---
"@objectstack/plugin-approvals": patch
"@objectstack/service-automation": patch
"@objectstack/service-messaging": patch
---

fix(plugin-approvals, service-automation, service-messaging): five system objects title their records with a text formula instead of the raw id (#20015)

Clause-②: no

ADR-0079 resolves a record's title as `nameField`, then `displayNameField`, then a derivation, and an explicit `nameField` takes precedence over the render-only `titleFormat`. Five system objects declared `nameField: 'id'` beside a composite `titleFormat`. A renderer that follows ADR-0079's order therefore showed the raw record id as the record page's title for:

- `sys_approval_request`, whose `titleFormat` is `{process_name} · {record_id}`;
- `sys_approval_action`, whose `titleFormat` is `{action} · {step_name}`;
- `sys_approval_approver`, whose `titleFormat` is `{approver} · {request_id}`;
- `sys_automation_run`, whose `titleFormat` is `{flow_name} · {node_id}`;
- `sys_http_delivery`, whose `titleFormat` is `{label} → {url}`.

Each object now declares `display_title`, a formula field with `returnType: 'text'` over the same columns, and points `nameField` and `displayNameField` at it. This is the migration the `titleFormat` schema text prescribes: "a composite to a formula field designated as nameField". The record title is now the text the `titleFormat` described. Where a source column is nullable (`step_name`, `node_id`, `label`), a row without it is titled by the other column alone.

A formula field is computed when a record is read. It adds no database column, so no schema migration runs. Record reads and write responses now carry `display_title`. For these objects the server-side title accessor (`resolveRecordTitle`) now returns the formula's text instead of the raw id.

`titleFormat` stays on all five objects, unchanged, for renderers that still read it first. `$search` resolution is unchanged: a formula field is never a search target, and neither was `id`.
