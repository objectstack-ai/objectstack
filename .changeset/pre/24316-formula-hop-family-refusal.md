---
'@objectstack/objectql': minor
'@objectstack/lint': minor
---

fix(objectql)!: the one-hop read through a reference never reads a stored-metadata-body table, and the lint refuses that read where it is written

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No stored metadata moves and nothing is converted: what narrows is a served value (a formula field or a validation rule that reads through a reference into a stored-metadata-body table) and an author-time verdict on such an expression; no spec key, export, option, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); nothing exported is removed (not runtime-export-retired) and no type changes (not type-surface-only or runtime-interface-only). -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The tables of the stored-metadata-body family (`STORED_METADATA_BODY_OBJECTS`) are projected or refused at every door that serves them. The one-hop read a formula field and a validation rule share (`resolveOneHopRelated`) was an ordinary engine read, which the family's projection does not reach.

- **`@objectstack/objectql`.** A hop whose target is a family table is not read, whichever authority the hop is read under. A formula field reading through it is `null` with its reason, on every read, write response and `serveFormulaField` call (the seam a hook body's `ctx.title()` reads through). A validation rule reading through it has no verdict, so the write it judges is refused. The answer is the one an unreadable related record gets, so it says nothing about the row. A hop into any other object is unchanged.
- **`@objectstack/lint`.** A formula field's `expression`, or a validation rule's hydrated `condition`, that reads through a reference into a family table is an error, with the prescription. `os validate`, `os build` and the object save door run the same pass, so the author learns it at save rather than from a `null`.

What to do. Remove the read through the reference. Stored metadata is read through the metadata API (`GET /api/v1/meta/:type/:name`), where its body is projected. Reading the reference field itself (the stored id) is unchanged.
