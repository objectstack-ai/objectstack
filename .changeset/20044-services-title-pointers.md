---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-security": patch
"@objectstack/service-messaging": patch
"@objectstack/service-realtime": patch
---

fix(plugin-approvals, plugin-security, service-messaging, service-realtime): nine system objects that relied on `titleFormat` declare a title pointer, so their record title is no longer the raw id (#20044)

Clause-②: no

ADR-0079 resolves a record's title as `nameField`, then `displayNameField`, then a derivation, and an explicit `nameField` takes precedence over the render-only `titleFormat`. Nine system objects declared a `titleFormat` and no pointer. When such an object is registered, the registry's designate-only pass picks the first title-eligible field as `nameField`, and for these nine that field is `id`. A `/meta` read serves that pointer as if it had been declared, so a renderer that follows ADR-0079's order showed the raw record id as the record page's title.

Eight of the titles are composites. Each of those objects now declares `display_title`, a formula field with `returnType: 'text'` over the same columns, and points `nameField` and `displayNameField` at it:

- `sys_approval_delegation`: `{delegator_id} → {delegate_id}`;
- `sys_position_permission_set`: `{position_id} → {permission_set_id}`;
- `sys_user_permission_set`: `{user_id} → {permission_set_id}`;
- `sys_user_position`: `{user_id} → {position}`;
- `sys_notification_delivery`: `{channel} → {recipient_id}`;
- `sys_notification_preference`: `{user_id} · {topic} · {channel}`;
- `sys_notification_subscription`: `{principal} · {topic}`;
- `sys_presence`: `{user_id} ({status})`.

`sys_notification_receipt`'s title is the single column `{state}`, so its `nameField` and `displayNameField` now name `state` directly.

This is the migration the `titleFormat` schema text prescribes: "Migrate a single-field title to nameField, a composite to a formula field designated as nameField". The record title is now the text the `titleFormat` described. Every column these titles read is required, so the formulas carry no null guard. Each formula reads only its own row's columns, never a field of a looked-up record.

A formula field is computed when a record is read. It adds no database column, so no schema migration runs. Record reads and write responses of the eight objects now carry `display_title`, and the server-side title accessor (`resolveRecordTitle`) returns the title text instead of the raw id. No row scope, permission set or API method changes.

`titleFormat` stays on all nine objects, unchanged, for renderers that still read it first. The set of fields `$search` scans is unchanged: a formula field is never a search target, and neither was `id`. On `sys_notification_receipt`, `state` was already in the set and now leads it. No search-companion column is provisioned for any of the nine.

The new `display_title` label and help text are in each package's English bundle. The zh-CN, ja-JP and es-ES bundles carry the generator's English fill for them, recorded in the source-hash companions.
