---
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(plugin-detail,app-shell,components): the record page's related switch decides whether the column exists, its panel switches are one segmented control in the header's action row, a 1440 px window with the sidebar is three columns, and the related order and body-table placement read the object's `relatedLists` and field groups

Clause-②: no
Metadata-protocol: none

The synthesized default record page (an object with no assigned page). Nothing an author writes changes meaning: the two read points below are keys the spec already declares.

- **The related switch.** With the related column switched off there is no related column and no 「Related」 rail toggle, in every column tier. With it on and no room for it (the two-column tier), the rail toggle opens and closes it. Before, the switch did nothing in the two-column tier and the rail still opened the column.
- **One segmented control in the header row.** The two panel switches are now one control with an icon and a label per segment (Timeline, Related column). It is drawn at the right end of the record header's action row, after `⋯`, behind a vertical hairline, in both column tiers. A segment that is on is filled with the accent tint; one that is off is muted text, so the state reads in the dark theme too. The crumb row keeps only the ways back and is not drawn when there is none. The shortcuts are unchanged (`⌘⇧.` / `⌘⇧,`); they now also match a key event that carries the typed character (`.` / `>`, `,` / `<`) but no physical key code.
- **Thresholds.** Three columns from a 1120 px container, two from 760 px, the tabs below (were 1280 / 1024). Measured on the console: the expanded sidebar is 256 px, so a 1440 px window is 1184 px of record page (three columns), and a 1024 px window is 768 px (two columns). `RECORD_PAGE_THREE_COLUMN_MIN_WIDTH` and `RECORD_PAGE_TWO_COLUMN_MIN_WIDTH` carry the new values and their derivation.
- **Related order.** The default order of the related cards, the Related tab and the body tables is the object's `relatedLists` first, then the derived order. That order already reached the page through `deriveRelatedLists`; the stale comment that said it did not is gone, and a mounted pin now holds it.
- **Body-table placement.** A field group whose `relatedList` names a body table's relationship (a child object name, or `object.field`) places that table at the group's position among the field groups. Other body tables stay after the first field section.
- **Restore default order.** Once a reader has moved or hidden a related card, the foot of the related column (and of the Related tab) offers 「Restore default order」 on the same line as 「N hidden · Show」. It lays the default order back, shows every card, and records the current default as the one the arrangement is based on. The reader's stored arrangement keeps its shape. The hint shown when the author's default changed stays as it was.
- **`@object-ui/components`.** `PanelToggles` is the segmented control. `PageHeaderTrailingContext` (new export) is the host slot at the end of `page:header`'s action row, and `PageHeaderActions` takes a `trailing` node for it. No metadata key reaches it.
- **`@object-ui/plugin-detail`.** `relatedListEntryNames` (new export) is the one reading of a related-list entry; app-shell's related-list order and the Studio editors import it from here.
- **`@object-ui/i18n`.** New `detail.relatedRestoreDefaultOrder` in the ten packs.

What to do: nothing.
