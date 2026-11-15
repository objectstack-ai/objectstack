---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): the write gate judges by id exactly the writes the engine runs by id

Clause-②: yes (widening): a request refused today lands when every matched row is admitted; measured again by the dev before the PR
Metadata-protocol: none

The sharing write gate now takes its by-id or bulk branch from the engine's own dispatch decision for the write's options. A write the engine runs by id is judged by id, as before. Every other write is one the engine runs as a predicate, an `$in` or `$eq` on `id` included, and it meets the bulk write scope: it writes the rows the caller may update or delete, leaves the others as they were, and answers no error.

A member's multi-row delete or update of rows it owns, on a `private` or `public_read` object with an `owner_id`, now lands where it answered 403 FORBIDDEN.
