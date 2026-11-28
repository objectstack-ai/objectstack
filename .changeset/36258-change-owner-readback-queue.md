---
'@objectstack/core': patch
---

fix(core): Change Owner answers a hand-away that leaves the caller's view as moved, and refuses a queue target on an object with no queue column behind it

Clause-②: no
Metadata-protocol: none

- **A record handed away that the caller can no longer see moved.** When storage reads the record back under the caller's row access, a record handed to someone else reads back as nothing straight after the write. The write still landed, and the engine says so. Change Owner read that empty answer as "not found": the single door answered `404 RECORD_NOT_FOUND` and told nobody, the bulk door listed the record under `failures`, and a cascaded child counted as refused. Now the single door answers `200` and sends the notice when asked, the bulk door counts the record under `updated`, and the child counts as moved. A record the caller cannot reach is still answered `404 RECORD_NOT_FOUND`, by the engine, before anything is written. The built-in SQL storage keeps the record visible to the caller after the write, so it never showed this.
- **A queue target on an external object is refused.** A queue target needs the platform's `queue` column with storage behind it. Change Owner checked only for a field named `queue`. The platform registers that field on every object that has an owner, external objects included, where no column backs it, so an external object got a queue write in place of the `400 VALIDATION_ERROR` ("has no ownership queue column"). An object whose fields are registered as a list was refused with that sentence although it has the column. Now Change Owner uses the engine's own test for the column, `resolveInjectedColumnProvenance(def, 'queue') === 'injected-provisioned'`, so list-shaped and record-shaped `fields` get the same answer. A field the author declared and named `queue` is not the ownership queue. It does not let a queue target through, which matches the engine's assignment rules.

Nothing to migrate.
