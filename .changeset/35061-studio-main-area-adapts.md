---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the main area adapts when the Studio right slot opens: narrow left rails, a four-column permission matrix, a Records grid that shows its scrollbar, and a resizable right slot

Clause-②: no
Metadata-protocol: none

- **Left rails narrow.** While the right slot shows beside the Studio pillars and the content column next to the 240 px list would be under 900 px, the Data, Automations, Interfaces and Access lists draw 52 px wide: each row shows the first character of its name, with the full name on hover. The 「»」 button at the top shows the whole list over the content until a row is picked, Escape or a click outside. Closing the slot or a wider window brings the full list back. Phones are unchanged.
- **Permission matrix (Access pillar, Objects tab).** When the matrix's pane is narrower than 1000 px, each object row keeps Create / Read / Edit / Delete as flat checkboxes. Export, Transfer, View all, Modify all and the read and write scopes move behind the row's "More permissions" button, which shows how many of those six are on ("2 on" / 「已开 2 项」) and opens them in a row beneath. The "All · Read only · None · Read & write" strip folds into one "Bulk" menu with the same four actions. At 1000 px and wider the matrix is the full flat grid it was. The folded controls are the same checkboxes and pickers as the flat columns, so a read-only set locks them the same way. The width rule is a CSS container query on the matrix pane, so it follows the right slot opening, closing or being dragged wider. Setup's permission set page draws a different table and does not fold.
- **Records tab (Data pillar).** The grid's horizontal scrollbar is drawn at rest instead of only under the pointer, so a pane the right slot narrows still shows there are more columns. Selecting a field by its column header, or from the field list, scrolls that column into view, clear of the frozen name column. Column widths, the frozen name column and the 400 px ceiling of a long text column are the runtime grid's, unchanged.
- **Right slot width.** The slot is resized from its left edge within 320–560 px, and the properties pane and the AI copilot each remember their own width in the browser (360 px and 420 px by default). A width both panes shared before this release is not carried over: each pane starts from its default once. The in-place widen of the copilot and the phone overlay keep their own widths.
- New `studio` namespace strings, in en and zh: `engine.studio.rail.expand`, `engine.studio.rail.collapse`, `perm.more.col` and `perm.more.count`.
