---
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-sharing': patch
---

fix(plugin-approvals, plugin-audit, plugin-sharing): list views no longer show the target object's API name as an Object column

Clause-②: no

- **The Object column leaves these lists.** These list views showed `object_name`, the target object's API name (such as `showcase_announcement`), as plain text beside the `record_id` record pointer. They no longer list it:
  - `sys_approval_request`: `all_requests`, `my_pending`, `submitted_by_me` and `completed`;
  - `sys_approval_action`: `recent` and `all_actions`;
  - `sys_audit_log`: `recent`, `writes_only`, `record_views` and `all_events`;
  - `sys_record_share`: all six views;
  - `sys_share_link`: all four views.
- **The Record column names the target record.** `record_id` is the id half of the `record_id` / `object_name` pointer pair. The console draws it as the target record, with its object's icon and the record's name, and fetches `object_name` for that cell without a column. This relies on a console that fetches a pointer's type half for its cell, as the console bundled with this release does; an older console draws the raw record id in that column.
- **Unchanged:** `object_name` stays a declared field on all five objects, and the pointer pair, its indexes and every query on it are untouched. `sys_audit_log`'s `config_changes` view keeps its Object column, because its rows carry no `record_id`.

A patch: entries removed from list view `columns` on shipped platform objects. No export, type, accepted value, served key or stored column changes.
