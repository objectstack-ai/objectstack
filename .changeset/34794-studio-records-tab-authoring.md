---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
---

feat(studio): the Data pillar's Records tab keeps Add field on screen, a header click opens the field, the name field leads, and the field inspector puts the label first

Clause-②: yes (widening) — an optional `columnMenuLabel` member on the exported `GridFieldAuthoring` context type of `@object-ui/components`, and new keys in the lazy `studio` namespace of the `@object-ui/i18n` packs; nothing that worked before is refused
Metadata-protocol: none

Studio's Data pillar, Records tab:

- **Add field is always on screen.** The records grid's toolbar row now starts with an Add field button that opens the same Add field popover. The trailing "+" column is kept. Both entries are offered only where a field may be added: not on a read-only package, not on an external object.
- **A header click opens the field.** Clicking a field's column header selects the field and opens its properties, and no longer sorts. Sort and hide are in the column menu, which a caret in every header now opens (the same menu a right-click opens). A column the object does not declare (such as the server's owner column) keeps the old click.
- **The name field leads.** The grid puts the object's name field first, frozen, in the shared order every list uses, and the server-injected columns (`owner_id`) after the author's fields. Only the Studio grid changes; runtime list views keep their column order.
- **The machine name is a tooltip.** The object's title no longer carries its machine name as a chip beside it; hovering the title shows it.

Field inspector:

- **The label comes first.** The display name is the first box. The API name moves into a collapsed "Developer info" section.
- **Delete is confirmed.** Remove moves from the inspector's footer into the header's "⋯" menu, and asks before it removes the field from the draft.

`@object-ui/components`: `GridFieldAuthoring` gains an optional `columnMenuLabel`. When a host sets it, every column header draws a caret, named by the value, that opens the table's own column menu (sort ascending, sort descending, hide). A table with no provider, or a provider that does not set the member, draws exactly the header it drew before.
