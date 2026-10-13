---
"@objectstack/platform-objects": patch
---

Setup's identity pages open on the tenant-wide list, not on the administrator's own rows. Before this, Setup → API Keys, Sessions, OAuth Applications, Identity Links and User Preferences opened each object's first declared list view, which was the caller-scoped "My …" view (`user_id = {current_user_id}`), so an administrator saw only their own keys, sessions, applications, links and preferences.

Clause-②: no

- On `sys_api_key`, `sys_session`, `sys_oauth_application`, `sys_account`, `sys_user_preference` and `sys_user`, the unscoped "All" view (`all_keys`, `all_sessions`, `all_apps`, `all_links`, `all_preferences`, `all_users`) is now declared first, and the caller-scoped view (`mine`, `me`) second. A route that names no view, such as a record page's object breadcrumb or the object switcher, now opens the "All" view. No view is added, removed or changed.
- The Setup entries `nav_api_keys`, `nav_sessions`, `nav_oauth_apps`, `nav_accounts` and `nav_user_preferences` now name that view with `viewName`, as `nav_users` already did. The Account app's Linked Accounts entry (`nav_account_linked`) now names `mine`, like the other Account entries, so neither app depends on the declared order.
- The "My …" views are still tabs on each page. The declared order decides which view opens, not which rows a caller may read: row-level security still scopes a member's rows.
- The generated translation bundles follow the new view order. No translated text changed.
- ⛔ No schema, parse, export or accept-set change.
