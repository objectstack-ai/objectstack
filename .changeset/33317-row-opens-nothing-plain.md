---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(plugin-grid, plugin-list, app-shell): a list row whose click opens nothing no longer looks clickable

Clause-②: yes (widening) — `ObjectGridComponentProps` (published by `@object-ui/plugin-grid`) and `ListViewProps` (published by `@object-ui/plugin-list`) each gain one optional prop, `rowOpensRecord?: boolean`. Absent, every row renders as before. Nothing is removed or narrowed.
Metadata-protocol: none

**Rows that open nothing.** A list row opens nothing when its view is authored `navigation: { mode: 'none' }`, or when its object's data API serves no single-record read (a list-only object, such as the SCIM connection credentials in Setup). The grid still drew such a row's first column as a link, and its right-click menu still offered Open and Open in new tab, so a click that did nothing looked like a broken page. The Console's object list, object data page and interface list pages now tell the grid that these rows open nothing (`rowOpensRecord={false}`, handed through `ListView`): the first column, and any column authored `link: true`, show the value as plain text, and the right-click menu offers no Open items. The row's actions (`list_item`) stay in the row menu and the right-click menu. The row click itself still reaches the host, so a Cmd/Ctrl-click on a row of a view authored `none` still opens the record in a new tab, as before. Rows that open a drawer or a page are unchanged.
