---
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
---

fix(console, grid): fewer requests per list navigation: a grouped grid asks the row write verdict once per operation, a list writes the user's preference row only when a preference changed, the inbox and approvals polls back off while nothing changes, and the command palette keeps the keys typed while it opens

Clause-②: no
Metadata-protocol: none

- `@object-ui/plugin-grid`: a server-grouped grid hands its rows to the record-grained write verdict (`POST /api/v1/security/explain`) once every open group's page has answered, instead of once per group. A list grouped into seven groups asked fourteen times; it now asks once per operation (`update`, `delete`), each request carrying every row on screen. The rows of each group still draw as soon as that group answers.
- Console: a sort, column layout, density, hidden-field or filter change that re-states what the user already stored, or that is undone before its write leaves, sends no `sys_user_preference` write. Each change is compared with the value the store holds.
- Console: the inbox and approvals feeds double the delay before the next poll each time a poll answers what is already on screen, up to 3 minutes, and return to the 60 s cadence on the first changed answer, on returning to the tab, and when a push channel opens or closes. Every poll still reads the whole window, so no arrival is dropped: it shows up at the next poll.
- Console: the keys typed between ⌘K (or the header search button) and the palette's input taking focus are the start of the query, instead of going to the page.
