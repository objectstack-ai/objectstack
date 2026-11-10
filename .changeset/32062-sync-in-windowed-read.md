---
'@objectstack/objectql': minor
'@objectstack/service-automation': minor
---

feat(sync-in): the windowed read of a datasource source, and a row-cap refusal that carries what the driver returned (ADR-0153 D2, first slice of the P2 engine)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — this slice changes nothing an author writes or sees (the reader is not reachable from `job.pull` yet); the sync-in skills update is ADR-0153's P3 guide + skills child

<!-- adr-0087: not-required (no-migration-prescription) This slice adds a reader nothing calls yet and widens one refusal's in-process payload; no key of any schema is added, removed, renamed or re-shaped, and no stored metadata changes meaning, so there is nothing for a migration to rewrite. The card's narrowings (a pull job's organization under `group`, the incremental `mark` refusal) land with the slices that enforce them, each with its own disposition. -->

The two declaration lines above are the P2 engine card's, which this release starts to deliver. This slice narrows nothing on its own: no metadata an author writes is refused that was accepted before.

- **`ExternalRowCapExceededError` carries what came back.** The engine's floor over a plugin driver still refuses a read that matches more than the datasource's row cap with `EXTERNAL_ROW_CAP_EXCEEDED` (422), on exactly the reads it refused before. The error object now also answers `returnedRowCount` and `returnedValuesOf(field)`: the rows the driver returned, held in a private field. They are never in `details`, never an own enumerable key, and never in any serialization of the error, so nothing that writes the error to the wire or a log carries row data. A fourth, optional constructor argument passes them. The prescription now points at sync-in (a `synced` object filled by a mapping whose `datasourceSource` names the object, pulled by a job) instead of the retired DataSync.
- **The windowed read (`@objectstack/service-automation`, internal).** The reader a datasource source's pull will use, on both read paths ADR-0153 D1 names. A built-in driver is read in aligned half-open windows `lo <= field < hi`, each whole and paged by the source key, with bounded windows only below the run-start high-water value and one more high-water read before the open-above window. A plugin driver is read through the floor: the open-above window first, bounded windows only below the largest value an over-cap answer showed, halved while they come back over the cap. A position is committed only at a window's end, at the canon-step floor of the smaller of the largest watermark value written and, on a built-in window read in several pages, the high-water value read before its first page. Nothing calls it yet; the next slice wires it to `job.pull`, so no `datasourceSource` mapping is pulled by this release.
- **New pull refusal reasons** on `ConnectorPullError` (the type every pull throws, now in its own module and still exported from the package root): `sync_window_unsplittable` and `sync_bounds_not_pushed` (`EXTERNAL_ROW_CAP_EXCEEDED`, 422), `source_key_not_exact` and `watermark_not_exact` (`VALIDATION_ERROR`, 400) for a key or an integer watermark read back outside ±2^53, and `watermark_start_invalid` (400) for a `watermark.start` the field's kind does not read.
