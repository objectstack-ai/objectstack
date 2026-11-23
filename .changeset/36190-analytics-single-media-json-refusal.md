---
'@objectstack/service-analytics': patch
'@objectstack/driver-sql': patch
---

fix(analytics)!: the native dataset face and the draft preview refuse `=` / `$in` / `$ne` on a single-value `image` or `file` column the driver stores as JSON, as the data door does

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no published skill documents the dataset door's filter vocabulary per storage class; the refusal text itself carries the prescription (the media-column move), and the operator contract `skills/` describes (`$contains` for membership on a JSON column) is unchanged

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, accepted value or export is added, removed, renamed or re-shaped: `SqlDriver.jsonColumnFieldClass` only becomes public, and the analytics hook beside it is optional and host-wired. What moves is the answer the native dataset face and the draft preview give a scalar comparison on a single-value media column, so no stored row, registry key or authored value changes and there is nothing for a migration to rewrite. -->

**BREAKING** for a caller of the dataset query door whose filter compares a single-value `file` / `image` / `avatar` / `video` / `audio` field with `=` (explicit or implicit), `$in`, `$ne`, `$nin`, an ordering comparison, `$between` or the non-membership text family, on a deployment still inside the ADR-0104 dual-encoding window (its media columns not yet moved, which is every deployment that has not run the move).

- FROM: the native dataset face compiled the comparison against the stored JSON string (`"file_1"`) and answered `200` with the wrong count — `{ pic: 'file_1' }` and `{ pic: { $in: ['file_1'] } }` counted `0`, `{ pic: { $ne: 'file_1' } }` counted every row — and the draft preview answered `200` with its own counts, matching the bare id a drafted row holds. `POST /api/v1/data/:object/query` and this door's ObjectQL strategy already refused the same filter `400` `INVALID_FILTER`.
- TO: all four faces refuse it `400` `INVALID_FILTER`, in `@objectstack/core`'s one refusal text for this column class — the media-column move, not the `$contains` membership repair, which finds no member in a single JSON string.

**Not moved.** `$contains` / `$notContains` and the null predicates (`$null`, `$exists`, `$empty`) on such a column, every operator on a scalar column, the multi-value and structured-JSON class (unchanged since it was refused on these faces), and a deployment whose media columns have moved — the column is not JSON there, and the comparison is answered.

The fix for a caller: filter on the record the attachment belongs to, ask presence with `$null` / `$empty`, or finish the deployment's media-column move (the column step of `objectstack migrate files-to-references --apply`, which the refusal text prescribes) so the column is comparable.
