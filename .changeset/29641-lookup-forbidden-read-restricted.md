---
'@object-ui/fields': patch
---

fix(fields): a lookup whose record read is refused draws the restricted-record placeholder, not a linked raw id

Clause-②: no
Metadata-protocol: none

A lookup cell reads the referenced record as the viewer to name it. When the target object's read gate refuses the viewer, the server answers that read with `403 PERMISSION_DENIED`, and the cell used to treat it as a failed read: the raw id beside a question mark, inside a link to a record page that refuses them. A permission refusal (status 403, or the `PERMISSION_DENIED` / `FORBIDDEN` code, as `@object-ui/react`'s `classifyLoadError` reads it) is now drawn like a record that was not found: "Restricted record", with no id and no link, and the refusal is cached so the record is read once. Any other failure (network, 5xx, 401) keeps the unresolved face with its id. `user` cells are unchanged: they never read the referenced person.
