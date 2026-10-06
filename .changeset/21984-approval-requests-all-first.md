---
"@objectstack/plugin-approvals": patch
---

Setup → Approvals → Requests opens on every approval request, not on the requests pending on the administrator. Before this, the entry named no view, and `sys_approval_request` declared the caller-scoped "My Pending" view (`pending_approvers contains {current_user_id}`) first, so the console opened it.

Clause-②: no

- `sys_approval_request` now declares its unscoped "All" view (`all_requests`) first. "My Pending", "I Submitted" and "Completed" follow it in their previous order, still as tabs. A route that names no view, such as a record page's object breadcrumb or the object switcher, now opens "All". No view is added, removed or changed.
- The Setup entry `nav_approval_requests` now names `all_requests` with `viewName`, so it does not depend on the declared order. The Account app's Approvals entry opens the Approvals Inbox component and reads neither.
- The declared order decides which view opens, not which rows a caller may read.
- The generated translation bundles follow the new view order. No translated text changed.
- ⛔ No schema, parse, export or accept-set change.
