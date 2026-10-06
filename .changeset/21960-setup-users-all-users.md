---
"@objectstack/platform-objects": patch
---

Setup → Users now opens on the "All Users" list. Before this, the console opened `sys_user`'s first declared list view, "My Profile". That view is filtered to the caller with a page size of 1, so an administrator saw one row, themselves, and nothing said the rest of the organization was one tab away.

Clause-②: no

- The Setup app's `nav_users` entry now sets `viewName: 'all_users'`. The key is the one the spec already declares on an object navigation item, and the console honours it. No new key, no `listViews` reorder, and no view is removed.
- "My Profile" (`me`) is still a tab on the Users page. The Account app's profile entry is unchanged: it is the `account:profile_card` component, which reads the signed-in user from the session, not this list view. The `me` view's code comment no longer says the Account app surfaces it.
- ⛔ No schema, parse, export or accept-set change.
