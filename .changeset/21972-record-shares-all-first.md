---
"@objectstack/plugin-sharing": patch
---

Setup → Record Shares opens on every share, not on the shares granted to the administrator. Before this, the entry named no view, and `sys_record_share` declared the caller-scoped "Granted to Me" view (`recipient_id = {current_user_id}`) first.

Clause-②: no

- `sys_record_share` now declares its unscoped "All" view (`all_shares`) first. "Granted to Me" and "Granted by Me" follow it, still as tabs. No view is added, removed or changed.
- The Setup entry `nav_record_shares` now names `all_shares` with `viewName`, so it does not depend on the declared order.
- The generated translation bundles follow the new view order. No translated text changed.
- ⛔ No schema, parse, export or accept-set change.
