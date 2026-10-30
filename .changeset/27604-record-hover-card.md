---
'@object-ui/fields': patch
'@object-ui/plugin-detail': patch
---

feat(fields): every record reference shows a hover card with the target's declared highlights, without navigating

Clause-②: yes (widening)
Metadata-protocol: none

Hovering a record reference for 400 ms, or pressing Space on it, shows a floating card: the target object's icon and label, the record's name as a link that opens it the way a click on the reference does, and the object's declared `highlightFields` minus the name field, at most six, drawn by the same cell renderers a list uses (option labels, currency, dates, lookups). Esc, moving the pointer away or blurring the reference hides it, and one card is open at a time. Focus alone does not show it.

- **Where.** Every lookup and master-detail value that links to its record (`LookupCellRenderer`): a relation column in a list, in a related list's table and in its enlarged view, and a lookup in the record's details. On the record page's related column, the name in a compact related row shows the card too, and its title opens the row as the name does.
- **What it reads.** Nothing until a card is shown; then one `findOne` for the record, with `$expand` naming only the reference fields the card draws. The answer is kept per record and read again after the data bus says the record changed, so a list of 200 rows reads nothing on render.
- **Metadata only.** Only the object's declared `highlightFields` are drawn: a name the object does not define, the name field and a field the viewer may not read are left out. An object that declares none shows the record's name and the object label. A record the viewer cannot read shows the reference's name and the object label.
- **Layout.** The card is portalled to the document body, so the row, cell or chip under it keeps its layout.

`@object-ui/fields` exports `RecordHoverCard` (with `RecordHoverCardProps` and `RecordHoverCardObjectDef`) for a host that draws a reference of its own: wrap the element that names the record and pass the target's `objectName`, `recordId` and the object definition the host already holds.
