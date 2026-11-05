---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
---

fix(plugin-list): a list's selection bar over a non-grid view (kanban, calendar, gallery, …) draws a declared bulk action only for a user who holds its `requiredPermissions` and only when its `visible` admits a selected record, through the grid bar's own gate (#30535)

Clause-②: yes (widening) — `@object-ui/plugin-grid` exports `useBulkActionItems` (with the `BulkActionItems` and `LegacyBulkActionItem` types), the grid selection bar's gate, so `@object-ui/plugin-list` reuses it instead of a second copy.
Metadata-protocol: none

- **Before.** The bar ListView draws itself for every view but the grid folded `bulkActions` through the grid's `resolveBulkActions` and kept only each action's label. An action declaring `requiredPermissions` drew for every user, and one declaring `visible` drew for every selection, while the grid's bar hid both. A name repeated in `bulkActions` drew two buttons under one React key.
- **Now.** The bar passes the resolved actions through `useBulkActionItems`, the hook the grid's bar and its right-click menu read: an action whose `requiredPermissions` the user does not hold is not drawn (unknown capabilities fail open, as on the grid), an action switched off is not drawn, and `visible` is evaluated once per selected record, drawing the action when at least one selected record passes. A repeated name draws one button. The development warning for an object whose schema could not be read now names the component it came from (`ListView` or `ObjectGrid`) instead of "the grid".
- **Remedy.** Nothing to change in metadata. A user who should see a gated action needs the capability it declares.
