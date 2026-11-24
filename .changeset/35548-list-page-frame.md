---
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

feat(console): the list page's frame — a 44px page bar, a 40px view bar, a denser grid and per-column totals in the grid's own last row

Clause-②: no
Metadata-protocol: none

The object list page is redrawn around two bars and a denser grid (objectstack#35548, the first card of the list-page epic):

- **Page bar, 44px.** The object's icon in one colour and its name on the left; ⋮ and 「+ 新建」 on the right. The object's description, Import and Favorite moved into ⋮.
- **View bar, 40px.** The view switcher is one trigger on the left, reading the view type's icon, the view name, the record count and a caret (the count beside the name returns, after objectstack#34603 removed it). 「筛选」「排序」「选项」 are text buttons on the right beside the search icon, and open the same panels as before; below `sm` they stay icons. The kanban and every other view type draw the same two bars. An empty condition row under the bar takes no height.
- **Grid.** A 32px header and 33px default rows, 13px on the header, the cells and the bar buttons, faint row lines, no rule after the first column, and the frozen-column shadow only once the grid scrolls sideways. The row ⋮ trigger is 24px so it fits the row. Lookup values read as small chips, money and number columns (a money formula with `returnType: 'currency'` among them) align right with tabular digits, and select labels keep their colour at lower saturation.
- **Totals.** Column summaries are drawn as the table's own last row, each figure under its column (so they line up at any width and are never covered by pinned columns), led by 「计数 N」; the separate footer line and its doubled colon are gone.

`DataTableSchema` gains one host-only runtime slot, `summaryRow` (`{ lead?, cells }`), which `ObjectGrid` fills; like `rowGroups`, the zod face refuses it by name, so it is not authorable. New locale keys: `list.options`, `grid.summary.countLead`.
