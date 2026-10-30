---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(components,plugin-grid,i18n,app-shell): record pane v4 mechanics — the split pane beside the list, the non-modal drawer over it, ⤢ maximize in place, the drag range, and the list's narrowed faces (#27545, part A)

Clause-②: yes (widening)
Metadata-protocol: none

No metadata key is added, removed or read differently. The console wires these mechanics in a following change; until then it passes none of the new props, and its only change here is the pane's default width.

- **`@object-ui/components`**: `NavigationOverlay`.
  - **Split face.** The pane sits beside the list the host hands over (`mainContent`), at that list's full height. The list is one element in every state, so it is not remounted by the overlay. Below a 1000 px content area (`RECORD_SPLIT_MIN_CONTENT_PX`) the split face falls back to the drawer.
  - **Drawer.** Over a `mainContent` list, the drawer is non-modal and draws no dimming overlay: an outside click leaves it open, and ✕ and `Esc` close it. A drawer with no list is the modal sheet it was.
  - **Width.** The divider drags from 360 px to 60vw. A remembered width is drawn inside that range (`min(Npx, 60vw)`). An authored width is no longer floored at `min(60vw, 880px)`.
  - **New `maximizable` prop.** It draws ⤢ / ⤡ and maximizes the pane in place. The pane's width becomes the viewport less the live sidebar width (`--sidebar-width`, or `--sidebar-width-icon` when collapsed; `SIDEBAR_WIDTH_FALLBACK` / `SIDEBAR_WIDTH_ICON_FALLBACK` where the variable does not reach). The list stays mounted and inert under it. `Esc` restores, and a closed pane forgets it.
  - **New `activeListRecordId` prop.** A list under the pane reads its narrowed face (`useRecordListFace()`: `columns` at ≥ 440 px, `cards` below, `full` with no pane beside it) and which of its rows is the open record (`ActiveListRow`, `useIsActiveListRecord`, `ActiveListRecordProvider`, `RecordListFaceProvider`). The open row is a per-row subscription, so a change re-renders the row it leaves and the row it reaches, not the list.
  - **`onExpand`** is drawn as ↗.
  - **`DataTable`** marks the open record's row (`data-active-record`, `aria-current`) and scrolls it into view.
- **`@object-ui/plugin-grid`**: `ObjectGrid` narrowed to `columns` keeps its first three view columns that are not avatars, plus its row actions. Narrowed to `cards`, it draws one card row per record, with the name and two chips. Under no pane nothing changes.
- **`@object-ui/i18n`**: `detail.maximize` and `detail.restoreSize` in all ten packs.
- **`@object-ui/app-shell`**: the console's record pane defaults to 720 px (`md`, clamped to 92vw) whatever the object's field count. `size: 'auto'` and no size both read as `md`, and an authored `size` or `width` stands. This applies to the object page's drawer and to the record page's related-record drawer.

What a console reader sees from this change alone:

- The record drawer's page button is drawn as ↗ instead of ⤢. It still opens the full page, under the same name.
- The record drawer is 720 px wide (at most 92vw) whatever the object's field count. Before, it took 480 to 1200 px by field count and was widened to at least `min(60vw, 880px)`: 864 px at a 1440 px viewport for an object of up to eight fields.
- A reader who chose Split in the Display menu sees the pane as a side panel. It draws no title heading. Its divider drags from 360 px to 60vw. The list beside it narrows to three columns, or to card rows below 440 px. The open row is not tinted yet: the console does not pass `activeListRecordId` until the following change. Below a 1000 px content area, the pane becomes a non-modal drawer over the list.
