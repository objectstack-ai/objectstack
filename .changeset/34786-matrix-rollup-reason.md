---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission matrix drops a roll-up acknowledgement when Read goes off and keeps it otherwise

Clause-②: no
Metadata-protocol: none

A permission set's field entry may carry `rollupSourceUnreadableReason`, the acknowledgement `os lint` reads on a roll-up `summary` column. The spec refuses it beside `readable: false`.

- Switching Read off on a field row now removes the reason in the same edit, the way it already removes a row condition. Before, the entry kept the reason beside `readable: false`, a shape the save refused, and the matrix offered no way to clear it.
- The field bulk shortcuts (Read-only all, Write all) now keep the reason on every row they rewrite, because those rows stay readable. Before, they dropped it silently.
