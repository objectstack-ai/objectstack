---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(record-page): the side preview opens 460 wide, puts the record's name first with one labelled action, and lists a child tab one row per record

Clause-②: yes (widening) — new optional members only: `RecordHeaderBar.preview` and `PageHeaderActionsProps.preview` on `@object-ui/components`, `ObjectGridComponentProps.cardFace` on `@object-ui/plugin-grid`; nothing removed or renamed
Metadata-protocol: none

The record preview that opens beside a list (and a record page's drawer level) is now a narrow pane:

- **Width.** It opens 460 px wide (at most 92% of the window). Its left edge drags it from 380 to 900 px. The dragged width is remembered in the browser under one key for every object's preview, not per object. An object, or the view that opens it, that authors its drawer's width (`navigation.size` other than `auto`, or a `navigation.width`, pixel or percent) does not use that key. It keeps its per-object key (`recordOverlayWidthStorageKey`, unchanged), which it shares with that object's calendar, gantt, kanban, tree and grid overlays, and its preview opens at the authored width until a width is dragged in that preview or one of those overlays. For an object that authors no size or width, the console's preview no longer shares a width with that object's calendar, gantt, kanban, tree or grid overlay.
- **Header.** The record's name comes first. The row shows at most one labelled action, the page's primary. The host's Edit and every other action go into the `⋯` in their usual order. The primary folds into the `⋯` too while the name would be cut below 16 characters' width. The copy-id icon after the name is gone, and 「Copy record ID」 is in the `⋯` instead. The full name is the name's tooltip. An approval's approve / reject levers and the record page's edit state (Cancel, Save) are drawn as before. A page's own header is unchanged.
- **`@object-ui/components`: every resizable drawer's range.** The range lives in `NavigationOverlay`, so it applies to every drawer opened with a `storageKey`: the calendar, gantt, kanban, tree and grid overlays, a resizable `RecordDetailDrawer`, and the console's preview. The drag range was 360 px to 60% of the window; it is now 380 to 900 px. On a 1920 px window the widest drag drops from 1152 to 900 px. On a 1024 px window a dragged or remembered width can now reach 900 px, where 60% of the window (614 px) capped it before; the drawer still never draws wider than the window less 1rem. A remembered width under 380 px is no longer used: the drawer opens at its host's width.
- **Child tabs.** A child list's tab draws one row per record (its title, one summary line and its status chip), the phone's card rows, instead of a table cut off at the pane's edge. `ObjectGrid` takes a new host prop, `cardFace`, that draws those rows at any window width.
