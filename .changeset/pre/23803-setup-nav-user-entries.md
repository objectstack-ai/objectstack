---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Setup's menu no longer lists "User Preferences" or "Identity Links". You reach both from the user they belong to: open a user in Setup › Users, and the user's page has a "Preferences" tab and its existing "Linked Accounts" tab.

Clause-②: no

Both lists held rows that belong to one user each: identity links are written when a user signs in with a provider, and preferences are what the console remembers as a user works (recent items, favourites, list settings). A menu entry listing them for every user at once was not a page an administrator works from.

- **Where they are now.** On a user's page, "Preferences" lists that user's preference rows (key, created, updated) and "Linked Accounts" lists their identity links, with the same Unlink action. New, Edit and Delete on the Preferences tab follow the same rules as the old list did. Search finds the user, and the tabs are on the user's page.
- **What did not change.** The two objects, their list views and their addresses are unchanged, so a bookmarked list still opens, and a preference row's breadcrumb still leads to the full list.
- **Nothing to migrate.** No data moves and no setting changes.
