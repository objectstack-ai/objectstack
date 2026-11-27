---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

**Shipped in 19.0.0-next.0**, whose CHANGELOG missed this entry; listed here one prerelease late.

feat(studio): a package's 概览 Overview page, with its Info and Pending tabs, and the package's ⋯ menu in its header

Clause-②: no
Metadata-protocol: none

Studio has a page for the open package itself, 概览 Overview, at `/studio/<package>/overview` (ADR-0084, amended 2026-11-26). It is drawn in the frame an item's page has, a header and a row of tabs:

- The header shows the package's name, a chip that reads 系统自带 (Built-in, with a lock) on a read-only package or 可写 (Writable), a chip that reads 使用中 (In use) or 已停用 (Disabled), and the description. The chips come from the package list's own answer (`writable`, `enabled`); a row that does not say draws no chip.
- The ⋯ package menu moved here from the top bar's left end. Its six rows are unchanged: edit info, export, duplicate, revert to last publish, adopt loose items, and Manage in Setup…. Disabling, enabling and deleting a package stay in Setup → Packages.
- 信息 Info lists the name, description, source, version and the package's app, read-only. The id, namespace and type are folded under 技术信息 (Technical details).
- 待发布 Pending (`?tab=pending`) is the pending-changes panel drawn in place, with its Publish all. It publishes through the same request, with the same review, notes, refusals and read-only rule as the top bar's Publish, which stays for now. Its tab shows how many drafts wait.

The Studio menu's first row, above its groups, is 概览 Overview. While drafts wait for a publish it carries their count as a badge, and one click on the badge opens the Pending tab. A search lists it when its name matches.

`DraftChangesPanel` takes two optional props, `embedded` (draw the panel in place instead of as a sheet) and `reloadKey` (read the drafts again when it changes); without them it behaves as before. New locale keys in the studio catalogue (en, zh): `engine.studio.menu.overview`, `engine.studio.menu.overviewPending` with its singular `engine.studio.menu.overviewPendingOne`, and `engine.studio.overview.*`.
