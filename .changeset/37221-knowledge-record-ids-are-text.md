---
'@objectstack/service-knowledge': patch
---

docs(service-knowledge): the knowledge service treats a record id as text; a caller-supplied numeric id on driver-memory or driver-mongodb is not supported

Clause-②: no
Metadata-protocol: none

The service TSDoc of the complete-reindex purge and the protocol page (`content/docs/protocol/knowledge.mdx`) no longer describe the numeric-id case as a known limit of the purge. They now say what the service supports: it treats a record id as text, and a caller-supplied numeric record id on driver-memory or driver-mongodb, which keep the id as given and do not equate `'5'` with `5`, is not supported. On such a row the purge's re-read, which asks by the id text, finds nothing, so a document whose row was restored during a complete reindex is deleted until the row's next change or the next full reindex. Ids the platform mints are text on every driver, so nothing changes for them. No behaviour changes.
