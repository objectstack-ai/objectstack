---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
---

feat(setup): Setup's metadata pages open Studio's All metadata area, the catalog's Active switch moves to each item's page, and Studio stops linking into Setup

Clause-②: no
Metadata-protocol: none

Setup no longer has a metadata editor or a metadata catalog (ADR-0146 D1). Studio's "All metadata" area serves those pages now.

- **Setup's metadata URLs redirect.** Each `/apps/<app>/metadata/...` route opens the same page in Studio's "All metadata" area: the directory, `_diagnostics`, a type's list, an item, its history and its create page. The legacy aliases redirect too: `component/metadata/{directory,resource}` in the shell, and `system/objects`, `system/metadata` and `system/{roles,positions,permissions}` in the console. `?package=`, `?scope=environment` and `?review=1` carry over, and each URL lands in one hop on the leg its query names.
- **The datasource stays in Setup.** Its routes render Setup's pages as before. It is runtime configuration, not metadata authoring, and the area sends datasource URLs back to Setup.
- **A bookmark of the retired Setup › Packaged automation page lands in Studio.** `/apps/<app>/component/automation/packaged?package=<id>` opens that package's Automations pillar, where a packaged flow's switch and New similar are, with the query kept. With no package named, it opens the area's cross-package list of flows.
- **The catalog entries leave Setup.** Positions, Capabilities, Permission Sets and Declared Sharing Rules leave Setup's navigation, and their labels are retired in all four locales. Home loses the "Manage Objects" quick action, and the sidebar loses its Objects entry.
- **The Active switch moves to the item's page.** A permission set, a position or a declared sharing rule is now switched on and off on its own page in the area. It is the same switch the catalog list had: switching off asks first and names how many users lose the access, and switching on writes at once. The area's type lists keep their switch column. **An admin with `setup.access` but no `studio.access` now switches these items in Studio.** Grant `studio.access` to anyone who managed the catalog from Setup.
- **Studio stops linking into Setup.** The landing page's environment-overlay link is gone. The read-only item link and the chat's "Review changes" now open the item in Studio's area.
