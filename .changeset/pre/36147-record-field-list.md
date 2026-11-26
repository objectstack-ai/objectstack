---
'@object-ui/plugin-detail': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

feat(console): the record page's field area is one list — one field a row in the side preview, on a phone and in the wide page's pinned left column

Clause-②: yes (widening)
Metadata-protocol: none

The synthesized record page's field area (objectstack#36147, ruling on the card 7066516044):

- **One column at any width.** The drawer (at any width), the split pane, the phone's 「详情」 tab, the wide page's pinned left column and a desktop full page that has other tabs but is not pinned (an opportunity's 详情 tab goes from three columns to one) draw the fields one a row: label left, value right, a hairline between rows. The phone's own grouped-inset face is gone there; it is the same list. A full page whose details are its only face (no other tab, none hidden) keeps laying a group out by width.
- **Group title row.** The title sits left and its chevron at the row's right end, pointing down while the group is folded and up while it is open; the whole row toggles.
- **Referenced records are chips.** A lookup value is drawn as a pill with the referenced object's colour tile (`ObjectSchema.color` / `icon`, objectstack#35985) and the record's whole name, wrapping rather than cut. A click on the chip opens the record; the rest of an editable lookup's row edits it. Everywhere else a reference keeps its link face.
- **Empty fields fold into one row.** Every empty field of every group is folded into the list's one last row (「显示 N 个空字段」), replacing the per-group toggle and the 「N 个空分组」 line on this page. The reader's choice is the per-object record-page preference `showEmptyFields` (objectstack#25883), so it holds for the next record of the object. An authored `hideEmpty` group stays hidden and is not counted.
- **「系统信息」 is the last group,** folded until opened: created by, created on, updated by, updated on (when the record was updated), the owner (when the body does not draw it) and the record ID, one fact a row. On this page it **replaces the one-line meta footer that objectui#12307 introduced**; outside the laid-out record page that line is unchanged.
- **A click edits; no pencil.** A single click on an editable value enters edit (a click on a link, a button or a text selection inside it is not taken); the hover pencil is no longer drawn, and stays in the DOM only as the keyboard's way in (visible on focus). A double click is no longer needed. **A read-only value takes no click any more**: the click-to-copy on read-only rows is removed on this page. For a mouse or a keyboard its copy icon, shown on hover or keyboard focus, stays; a touch screen shows none, and the value is selected by a long press.
- Authored record pages and every other DetailView keep their faces.

`@object-ui/fields` widens: it exports `ReferenceChipContext` (a boolean React context, default `false`) that switches `LookupCellRenderer`'s reference link to the chip face.

`@object-ui/i18n` widens: five new keys in every pack, `detail.systemInfo` (系统信息 / System information), `detail.createdTime`, `detail.updatedTime`, `detail.recordNumber` and `detail.clickToEdit`.
