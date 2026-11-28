---
'@object-ui/plugin-kanban': patch
---

fix(kanban): a list view board laned by a lookup draws its "Uncategorized" lane when every record with an empty lookup sits past the first page

Clause-②: no
Metadata-protocol: none

A list view hands its kanban one page of the view's query. On a board laned by a lookup field, the grouped lane read already counts every lane, the records with an empty lookup included, and the lanes whose records all sit past the page are drawn from it. The trailing "Uncategorized" lane was not: it was drawn only by the cards it held, so when every record with an empty lookup sat past the first page those records had no lane on the board at all. The board now draws that lane from the read's count, last, with its whole count and the "Cards not loaded" line. A source with no grouped door, or a read that is refused or cut, draws it from the page's cards as before. Boards laned by a text field or by declared options are unchanged. Nothing to migrate.
