---
'@object-ui/components': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(record-page): the side preview opens 460 wide, puts the record's name first with one labelled action, and lists a child tab one row per record

Clause-②: yes (widening) — new optional members only: `RecordHeaderBar.preview` and `PageHeaderActionsProps.preview` on `@object-ui/components`, `ObjectGridComponentProps.cardFace` on `@object-ui/plugin-grid`; nothing removed or renamed
Metadata-protocol: none

The record preview that opens beside a list (and a record page's drawer level) is now a narrow pane:

- **Width.** It opens 460 px wide (at most 92% of the window). Its left edge drags it from 380 to 900 px, and the width is remembered in the browser for every object's preview, not per object. An object that authors its drawer size keeps it.
- **Header.** The record's name comes first. The row shows at most one labelled action, the page's primary. The host's Edit and every other action go into the `⋯` in their usual order. The primary folds into the `⋯` too while the name would be cut below 16 characters' width. The copy-id icon after the name is gone, and 「Copy record ID」 is in the `⋯` instead. The full name is the name's tooltip. An approval's approve / reject levers and the record page's edit state (Cancel, Save) are drawn as before. A page's own header is unchanged.
- **Child tabs.** A child list's tab draws one row per record (its title, one summary line and its status chip), the phone's card rows, instead of a table cut off at the pane's edge. `ObjectGrid` takes a new host prop, `cardFace`, that draws those rows at any window width.
