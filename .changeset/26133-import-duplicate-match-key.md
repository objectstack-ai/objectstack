---
'@objectstack/core': patch
'@objectstack/spec': patch
---

fix(core)!: an `update` / `upsert` import refuses its own rows that share a match key, before any write

Clause-②: no (narrowing: rows of one `update` / `upsert` import that carry the same coerced `matchFields` key, which used to be written one by one, now all fail with `DUPLICATE_MATCH_KEY` and none of them is written)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is the per-row answer of the import runner for a file that repeats a match key; the caller's migration is the one the row error names: keep one row per key and import again. -->

**BREAKING** for an import that carries the same match key on two or more of its own rows. Before, an `upsert` wrote every one of them: under a key no stored record carried yet each row was created, so the object held two records for one business key and every later import of that key failed with `AMBIGUOUS_MATCH` until someone deleted the extra record by hand; under a key a stored record carried, each row updated that record in turn and the last row silently won. An `update` import did the same silent double update.

- **The refusal.** Before any row is written, the import runner (`runImport`, behind `POST /data/:object/import`, the async import job, the connector pull and the user import) groups the rows by their match key. Every row of a key carried more than once fails with `ok: false`, `action: 'failed'`, `code: 'DUPLICATE_MATCH_KEY'`, and its `error` names every row that carries the key and the key set (`Rows 1, 2 of this import have the same match key (supplier + cert_type + cert_no), so none of them was written: keep one row per key and import again`). None of them is written. The other rows of the file import as before.
- **What counts as one key.** The key set the row is matched by (the first set of `matchFields` whose fields are all non-blank on it) with its cell values as coerced, the values the matcher queries with. So `ISO 14001` (an option label) and `ISO14001` (its value) are one key, and so are two spellings of one lookup target. A row blank on every key set, or whose key cells fail coercion, has no key and answers as before.
- **The dry run answers the same.** A `dryRun` preview reports the same `DUPLICATE_MATCH_KEY` rows the import would.
- **Every object.** An object with a unique index over the key answers the same refusal: before, its import created the first row and failed the second with `UNIQUE_VIOLATION`, while its dry run reported both as created.
- **Unchanged.** A file without repeated keys answers exactly as before, and an `insert` import, which matches nothing, still writes every row.

**Who moves.** A caller that imports a file repeating a match key now gets those rows back as failures: keep one row per key (the one that is right) and import again. `@objectstack/spec` adds `DUPLICATE_MATCH_KEY` to the error-code ledger and to the `matchFields` contract text.
