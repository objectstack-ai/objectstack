---
'@objectstack/plugin-audit': patch
'@objectstack/plugin-sharing': patch
---

fix(plugin-audit, plugin-sharing): record pages, the `by_object` grouping and the Config list no longer name the target object by its API name

Clause-②: no

- **A record share's title is its recipient.** `sys_record_share` declares `nameField: 'recipient_id'`. It declared no title pointer, so the registry derived `object_name` (the first `*_name` text field), and a record share's page heading read the shared record's object API name, such as `showcase_announcement`. Its `titleFormat` is removed: the declared pointer outranks it everywhere.
- **A share link's title is its label, else what it grants.** `sys_share_link` declares `nameField: 'label'`, the field the registry already derived. A link with no label is titled by `titleFormat: '{permission} · {audience}'` (for example "View · Anyone with the link") instead of `{object_name}/{record_id} ({permission})`.
- **`sys_audit_log` drops its `titleFormat`.** It read `{action} · {object_name}`, but the required `action` pointer outranks it, so it never titled a row.
- **The strip lists neither half of the pointer pair.** `highlightFields` no longer lists `object_name` or `record_id` on the three objects. The record page's strip drew them as stored text, an API name and a raw id. A strip field is also hidden from the Details tab, which is where `record_id` draws as the record card, headed by the target object's label.
- **`sys_record_share.by_object` sorts by object instead of grouping on it.** A group header drew `object_name` as stored text. The sort still keeps one object's grants together.
- **`sys_audit_log.config_changes` drops its Object column.** Its rows carry no `record_id`, so the column drew a stored API name (`sys_setting`, `sys_platform_setting` or `sys_user`) with no record beside it.
- **Unchanged:** `object_name` stays a declared field on all three objects, and the pointer pair, its indexes and every query on it are untouched. On the record page, the Details tab still shows `object_name` as a row of its stored text.

A patch: title and highlight declarations and list view keys change on shipped platform objects. No export, type, accepted value, stored column or authorable key changes.
