---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(plugin-detail,app-shell): the default record page is one page at two widths — resident columns on a wide page, the tabs in a drawer

Clause-②: no
Metadata-protocol: none

The synthesized default record page (no authored page, or a slotted page that keeps the default tab strip) used to be tabbed at every width: on a wide screen the details took the whole width while the timeline, the related lists and the comments each sat behind a tab click. It is now laid out by the width of the view it occupies — never the viewport, so the same page in a drawer stays narrow:

- **1280 px and up:** three resident columns — details · timeline (the discussion composer on top, then Activity and History) · related (each related list as a card naming its first rows, then the opt-in reference rail and `rightRail` slot, Approvals, Attachments and the created / updated line). No tab strip.
- **1024 – 1279 px:** details · timeline; the related column folds into a rail opened from a **Related (N)** toggle above the columns. Closed, its lists read nothing.
- **Below 1024 px, and whenever the view is embedded (drawer / split pane):** the tab strip, exactly as before.

One header (title, actions, highlights, stage path) serves every tier. No metadata key, page template or node type is added: the page description stays the tabbed one Studio seeds, and the columns are read off it by each tab's stable `value`. `?tab=` keeps selecting a tab in the tabbed tier and is ignored by the columns. An authored record page (`kind: 'full'`) and an authored `slots.tabs` strip are drawn as authored at every width. In a column tier History is resident, so its audit read goes out when the page opens instead of when its tab is clicked.

New `@object-ui/plugin-detail` exports for a host wiring the same layout: `useRecordPageTier(element, { embedded, enabled })`, `recordPageTierFor(width)`, `buildDefaultPageColumns(page)`, `recordPageColumnOfTab(value)`, `RecordPageColumns`, the `RECORD_PAGE_THREE_COLUMN_MIN_WIDTH` / `RECORD_PAGE_TWO_COLUMN_MIN_WIDTH` floors and their types. Additive: nothing existing changes shape.
