---
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

feat(grid): on the list page a lookup chip opens its record in the side drawer, and a lookup cell has an edit button

Clause-②: yes (widening)
Metadata-protocol: none

On the console's list page, a single click on a lookup chip (a record of another object, such as a contact's account) now opens that record in the side drawer over the list. This replaces, for lookup chips on that page, the earlier change in this release where a plain click on a lookup chip only selected its cell. The list stays where it was: closing the drawer leaves its scroll position and the selected cell as they were. The drawer's address carries the record and its object (`?recordId=…&recordObject=…`), so a reload keeps it open and Back closes it, as with the name cell's "Open in side panel" icon. A click beside the chips only selects the cell. A cell of several chips opens the chip that was clicked; Ctrl/Cmd+Enter on the selected cell opens the first one in the drawer; Ctrl/Cmd-click still opens the record's page in a new tab.

A lookup cell now draws an edit (pencil) button while the pointer is over it and while it is selected. It opens the cell's editor, as a double-click or Enter does, and it is not drawn when the cell cannot be edited (no permission, a read-only field, a locked record). It takes the place of the open button a selected cell shows.

A chip naming a person (an owner, a creator: a lookup to `sys_user`) keeps the behaviour it had: a single click only selects the cell, and it opens from the open button or Ctrl/Cmd+Enter. Email, phone and URL cells and the name column are unchanged. On a phone every record still opens as its page.

For hosts: `ListView` and `ObjectGrid` take a new runtime prop, `openReferencedRecord(objectName, recordId)`, that opens such a record in the host's place; `GridCellSelection` gains an optional `referenceCells` member (`isReferenceColumn`, `openRecord`), exported with its type `GridReferenceCells` from `@object-ui/components`. A host that passes neither keeps the previous behaviour, where a chip only selects its cell. `ReferencedRecordLink`'s anchor now carries `data-record-object` and `data-record-id`.
