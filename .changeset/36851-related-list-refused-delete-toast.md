---
'@object-ui/plugin-detail': patch
---

fix(record-page): a refused delete from a related list says it was refused

Clause-②: no
Metadata-protocol: none

Deleting a row from a record page's related list when the server refused the delete (a hook, or a record lock answering `409 RECORD_LOCKED`) showed nothing: the confirm dialog closed, the row stayed, and the refusal reached only the browser console. The list now shows the toast the object's list page shows for the same refusal: "Failed to delete LABEL", described by the refusal's `userMessage` when the server marked one, the read-only sentence for an external data source, and otherwise the server's own sentence. The row stays in the list and the dialog closes, as before. A delete that succeeds is unchanged. No props, exports or locale keys change.
