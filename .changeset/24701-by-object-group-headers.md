---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-webhooks': patch
---

fix(plugin-sharing, plugin-webhooks): the `by_object` lists of sharing rules and webhooks no longer head each group with an object API name

Clause-②: no

- **`sys_sharing_rule.by_object` and `sys_webhook.by_object` sort by object instead of grouping on it.** Both grouped on `object_name`, and a group header draws its value as stored text, so each group was headed by an API name such as `crm_account`. The sort on `object_name`, then `label`, still keeps one object's rows together, and the Object column still draws each object's icon and label.
- **Unchanged:** `object_name` stays a declared field on both objects, with the same widget, and no stored column, index or query changes.

A patch: one list view key is removed on each of two shipped platform objects. No export, type, accepted value, stored column or authorable key changes.
