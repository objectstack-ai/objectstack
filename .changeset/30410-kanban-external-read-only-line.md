---
'@object-ui/plugin-kanban': patch
---

Clause-②: no
Metadata-protocol: none

A kanban card move refused because the object's external datasource does not admit writes (`403 EXTERNAL_WRITE_FORBIDDEN`, ADR-0015) now says the table is read-only (`form.readOnlyExternalSource`) instead of "You are not authorized to perform this action.", which sent administrators looking through permission sets that can never unlock the table. The read-only check runs after an author-marked `userMessage` and before the permission check, the order the other write doors use; every other 403 keeps today's text.
