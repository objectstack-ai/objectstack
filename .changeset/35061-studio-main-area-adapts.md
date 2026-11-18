---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): with the right slot open, the main area adapts: the permission matrix keeps four columns and the Records grid shows its scrollbar

Clause-②: no
Metadata-protocol: none

- **Permission matrix (Access pillar, Objects tab).** When the matrix's pane is narrower than 1000 px, each object row keeps Create / Read / Edit / Delete as flat checkboxes. Export, Transfer, View all, Modify all and the read and write scopes move behind the row's "More permissions" button, which shows how many of those six are on ("2 on" / 「已开 2 项」) and opens them in a row beneath. The "All · Read only · None · Read & write" strip folds into one "Bulk" menu with the same four actions. At 1000 px and wider the matrix is the full flat grid it was. The folded controls are the same checkboxes and pickers as the flat columns, so a read-only set locks them the same way. The width rule is a CSS container query on the matrix pane, so it follows the right slot opening, closing or being dragged wider. Setup's permission set page draws a different table and does not fold.
- **Records tab (Data pillar).** The grid's horizontal scrollbar is drawn at rest instead of only under the pointer, so a pane the right slot narrows still shows there are more columns. Selecting a field by its column header, or from the field list, scrolls that column into view, clear of the frozen name column. Column widths, the frozen name column and the 400 px ceiling of a long text column are the runtime grid's, unchanged.
- Two new `studio` strings, in en and zh: `perm.more.col` and `perm.more.count`.
