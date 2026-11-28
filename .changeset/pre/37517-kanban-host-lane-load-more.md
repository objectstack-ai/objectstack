---
'@object-ui/plugin-kanban': patch
---

fix(kanban): a list view board laned by a lookup loads the rest of a lane's cards with "Load more"

Clause-②: no
Metadata-protocol: none

A list view hands its kanban one page of the view's query. On a board laned by a lookup field, the grouped lane read counts every lane, so a lane could read 30 while drawing the 13 cards of it on the page, and a lane whose records all sat past the page (the trailing "Uncategorized" lane included) read 10 with no card and no way to see them. Each lane that draws fewer cards than the read counts now has "Load more" at its foot. It reads the lane's next records under the view's filter, sort and search, starting right after the lane's cards on the page, and adds them to the lane. The list's page and the cards a lane loaded are read again together when the list refetches. A source with no grouped door, or a read that is refused or cut, offers no "Load more", as before. Boards laned by a text field or by declared options are unchanged. Nothing to migrate.
