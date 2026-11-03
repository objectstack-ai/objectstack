---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(ui)!: a record opened from a list opens in the drawer by default, and the split pane beside the list retires

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/components#RECORD_SPLIT_MIN_CONTENT_PX, @object-ui/components#RecordListFaceProvider, @object-ui/components#useRecordListFace, @object-ui/components#recordListFaceFor, @object-ui/components#RECORD_LIST_CARD_FACE_BELOW_PX, @object-ui/components#RECORD_LIST_NARROW_COLUMN_COUNT, @object-ui/components#RecordListFace) the retired operands are a React context provider, a hook, a helper, two constants and a type of the split pane's narrowed list face, in a published ui package's entry; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names them (the split mode already left `NavigationModeSchema`), so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that drew the split pane through `@object-ui/components`, read its narrowed list face, or passed the Display menu a `split` choice. The maintainer ruled 「默认改抽屉，分屏彻底退役，只留抽屉和整页」: a record opens in the drawer or as the full page, and the split pane is gone.

- **The Console.** A row click on a drawer-mode object opens the record in the non-modal drawer over the list, which keeps its full width and every view column. A click on another row swaps the record, ↑ ↓ step through the list, the drawer drags from 360 px to 60% of the window, and ⤢ maximizes it in place. A view that declares `navigation.mode: 'page'` and a phone still open the full page. No metadata changes: `navigation.mode` keeps its values.
- **The reader's preference.** The Display menu's 「打开记录」 (Open records) offers Drawer and Full page only. The preference under `os:record-open-mode` is `drawer` or `page`; a stored `split` is an unknown value and reads as the default, the drawer, with no compatibility read.
- **`@object-ui/components`.** `NavigationOverlay` draws the drawer for `mode: 'drawer'` and no longer has a `split` face: `NavigationOverlayMode` is `page | drawer | new_window | none`. Over a `mainContent` list the drawer is non-modal and undimmed, as before, and the list keeps its full width. The open-row store stays (`ActiveListRecordProvider`, `useIsActiveListRecord`, `ActiveListRow`, `useScrollActiveListRecordIntoView`, `listRecordIdOf`). The split pane's 「Close panel」 label is no longer drawn; the drawer's ✕ is 「Close」.
- **`@object-ui/plugin-grid`.** The grid no longer narrows to three columns or to compact card rows beside a record pane; it draws every view column.
- **`@object-ui/plugin-list`.** `ListView`'s record-count bar always prints its count. The `recordOpen` host prop offers two choices: its `preference` is `'drawer' | 'page'`, its `setPreference` takes either, and its `selectPage` member is gone (pass `setPreference('page')`).
- **`@object-ui/i18n`.** `list.recordOpenSplit` leaves all ten packs.

What leaves, and what to write instead:

- FROM `RECORD_SPLIT_MIN_CONTENT_PX` TO nothing: the drawer has no width floor to fall back from.
- FROM `RecordListFaceProvider` TO nothing: no list is narrowed any more, so there is no face to publish.
- FROM `useRecordListFace` TO nothing: a list under the drawer draws its full face; read `useIsActiveListRecord` for the open row.
- FROM `recordListFaceFor` TO nothing.
- FROM `RECORD_LIST_CARD_FACE_BELOW_PX` TO nothing.
- FROM `RECORD_LIST_NARROW_COLUMN_COUNT` TO nothing.
- FROM `RecordListFace` TO nothing.

A host that passed `mode="split"` to `NavigationOverlay` passes `mode="drawer"` with the same `mainContent`. A host of the Display menu that passed `selectPage` drops it and lets `setPreference` receive `'page'`.
