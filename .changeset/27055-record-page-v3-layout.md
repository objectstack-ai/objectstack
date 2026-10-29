---
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-detail,app-shell,components): the record page v3 — frameless details, one timeline, compact related cards the reader arranges, body tables, enlarge in place

Clause-②: no
Metadata-protocol: none

The synthesized default record page (an object with no assigned page) takes the v3 layout. Nothing an author writes changes: the page is still drawn from the object's semantic roles (ADR-0085), and every change below is the renderer's.

What changes for a reader:

- **Header.** One filled primary action, two outline actions, the rest in the `⋯` menu. The header's Refresh moved into that menu as its first item. Up to six highlights, drawn as an equal-width grid on the default page.
- **Details.** Sections are frameless: a title over a hairline, then the fields in one to three columns by how many fields the section shows. Every titled section collapses from its title. Sections with no value at all fold into one line at the foot, such as 「Address · Conversion · Extra · 3 empty sections · Expand」. The created / updated line closes the details column and also names the owner and the record id.
- **Timeline.** One stream: comments, `sys_activity` rows and field changes (`trackHistory`), newest first, with the composer on top and the chips All / Activity / Discussion / Changes. Field changes and system events are one muted line each. 「View all N →」 shows the rest. The separate History tab, the Activity tab and the discussion footer are gone. With `enable.feeds: false` the stream keeps activity and changes and offers no composer.
- **Related cards.** In the related column each related list is a compact card: title, count and ＋ in one row, no table header, up to three rows of the record's name and one status or date chip. The column is 320 px, beside details and the timeline at 1.25fr : 1fr. 「查看全部」 is gone from the card.
- **The reader arranges the cards.** On desktop the title row drags a card, with a drop line. The card's `⋯` menu has Move up, Move down, Collapse and Hide. A collapsed card shows its title and count and reads no rows. The order, collapsed and hidden state are kept per user and object in the console's workspace preferences, the same store as the column switches, and apply in the tabbed tier's Related tab too. A reader who never dragged sees the default order. A later change to the default does not reorder a dragged column; the column then says 「Default order updated · Restore default」. A relationship added since the reader's last drag lands after its nearest default neighbour and carries a 「New」 badge for 48 hours. Hidden cards are listed at the column's foot (「N hidden · Show」).
- **Enlarge in place.** A card's ⤢ or its count opens the list as a full-width table over the page body, with every column, paging, sort and inline edit. The address is `?related=object.field`; Esc or ‹ returns to the columns.
- **Body tables.** A related list that is the record's own body is drawn as a table inside the details column, right after the first field section, instead of a side card. A body list is a `master_detail` FK declaring `inlineEdit`, or a list marked `relatedList: 'primary'`. A body table opens on ten rows and has a totals line for its numeric columns over the rows on the page.
- **Tabs.** The drawer and narrow widths show Details / Timeline / Related / (Approvals). The Timeline is second for a worked object and last otherwise. Attachments close the Related tab.

**BREAKING** (`@object-ui/plugin-detail`, TypeScript only): `BuildPageOptions` no longer accepts `hideHighlights`, `hidePath`, `showReferenceRail`, `hideReferenceRail`, `hideRelatedTab`, `relatedLayout`, `recordChrome`, `showActivity`, `history`, or the `slots.rightRail` slot. No console caller passed any of them. A caller still passing one gets a compile error naming the key, and the page it draws is the same with the key or without it. The `record:reference_rail` renderer stays for authored pages. `buildDefaultHeader` takes `{ actions }` only, and `buildDefaultHighlights` drops its two hide flags.

<!-- adr-0087: not-required (runtime-interface-only ui/packages/plugin-detail/src/synth/buildDefaultPageSchema.ts#BuildPageOptions) a renderer's options interface: no Zod schema, no spec declaration and no stored representation reads it, so the compiler is the channel that reaches every caller -->
