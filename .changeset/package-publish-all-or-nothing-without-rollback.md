---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a refused package publish leaves nothing live on a runtime that cannot roll back

Clause-②: no
Metadata-protocol: none

A package publish (`publishPackageDrafts`, behind `POST /packages/:id/publish-drafts` and Studio's publish-all) is all-or-nothing (ADR-0067 D2), and relied on `engine.transaction()` to undo the drafts it had promoted before a refused one. On a runtime whose default driver declares no transactions, such as the remote Turso transport, the engine runs that callback with no rollback. A draft refused at item 9 of 11 therefore left items 1–8 live while the response said nothing had taken effect.

Where the runtime cannot roll back (the `engineCanRollBack` check that `/discovery`'s `transactionalBatch` already answers), the publish now judges every draft before it promotes any, so a refusal leaves every draft pending and nothing served. A failure that only the writes themselves can meet, such as a draft saved under the publish or a store fault, undoes every promotion already made before the refusal is reported: rows the publish created are removed, rows it edited go back to their prior version, and each consumed draft is put back unchanged. Each undo step leaves its own history event. An undo that itself fails is named in `failed[]`, without `BATCH_ABORTED`, and in an error log, instead of being reported as "nothing landed". Runtimes with a real transaction behave exactly as before.
