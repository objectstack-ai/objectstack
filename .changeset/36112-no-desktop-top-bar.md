---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): from 768 px up an app draws no top bar; what it carried moves to the sidebar and the content area

Clause-②: no
Metadata-protocol: none

Part of objectstack#36112 (epic #36107). An app page from 768 px up now starts at the window's top:

- **Sidebar head.** The first row is the app's glyph and name, which open a menu that only switches apps (the viewer's apps with the current one checked, Setup among them for the viewers the server serves it to, a search field past eight apps, and 「Add app」 for a workspace admin who may author: build with AI or in Studio, start from a template, the marketplace), with the collapse button beside it. The second row is search (`⌘K`) and the notification bell.
- **Sidebar foot.** The account menu: avatar, name and, in a walled organization, the organization's name; the same entries the avatar menu had (profile, connect an AI assistant, organizations, hidden apps, theme, language, notifications, log out), plus the stage chip on a preview or beta deployment.
- **Content area.** The impersonation, read-rate and storage banners and a lost-connection notice sit at the top of the content, its width.
- **Page header.** While the sidebar is collapsed the page header draws the expand button first; a route with no shell header gets it at the content's top-left corner. The page's button group (#36111) is always on; the `os:shell:page-actions` storage switch is gone.
- `⌘⇧H` goes home from any app page at every width (the app layout installs it, not the bar).

Unchanged: a phone keeps its top bar and bottom bar; an app's docs pages, which mount no sidebar, keep the bar at every width; `/home`, the organization pages and Studio keep their bar; the sidebar's fold below 1416 px and its keep-open choice are as before.

New strings in all 11 locales: `sidebar.collapse`, `sidebar.expand`, `layout.appSwitcher.addApp`.
