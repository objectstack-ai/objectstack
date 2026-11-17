---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
'@objectstack/lint': minor
'@objectstack/cli': patch
'@objectstack/metadata': patch
---

fix(spec,metadata-protocol)!: retire the seed modes `insert` and `replace`, which inserted every record again on each replay

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #34798

<!-- adr-0087: registered seed-mode-insert-replace-retired -->

**BREAKING** for a seed dataset authored with `mode: 'insert'` or `mode: 'replace'`. A seed is replayed on every single-tenant boot, every package install or upgrade and every publish, and neither mode matched an existing row, so every replay inserted each record again: an un-walled install went from 1 to 2 to 3 rows over three boots, a person reference the first load had to leave empty stayed empty on the first row while only the newest copy named the person, and with a unique field the replay insert was refused and the one row stayed empty. `replace` expected the caller to clear the table first, and no load path ever clears one.

What moves (each line FROM → TO):

- `SeedSchema.mode` / `SeedMode` (`@objectstack/spec/data`; `defineSeed`, `defineStack({ data })`, a `seed` metadata item, a package body's seed): FROM `insert` / `update` / `upsert` / `replace` / `ignore` TO `update` / `upsert` / `ignore` (default `ignore`, unchanged). `mode: 'insert'` or `mode: 'replace'` fails parse with a prescription naming the fix; the save and publish doors refuse it with the same message. The retired pair is exported as `RETIRED_SEED_MODE_VALUES` (`@objectstack/spec/data`): it is derived from the parse refusal's own table, and the loader and the artifact door read it.
- a stored dataset that still declares one, replayed by the boot seed, the per-organization replay, the dev hot reload or a package install, upgrade or sample-data reseed (`SeedLoaderService.loadStored`, `@objectstack/metadata-protocol`): FROM inserted again on every load TO refused alone — it writes nothing, the load result carries one error with the prescription and `success: false`, and every other dataset loads. `SeedLoaderService.load()` and `validate()` refuse the dataset the same way when handed one unparsed, so a dry run reports what a real load does.
- a compiled artifact (`objectstack.json`) carrying such a dataset, booted by `os serve` / `os start` / `os dev` (the artifact door, `MetadataPlugin`, `@objectstack/metadata`): the door parses the artifact without that dataset and hands it back to the seed load, which refuses it alone; the door logs a warning naming the dataset and the fix. Everything else in the artifact registers and boots.
- `os diff` (`@objectstack/cli`) on a dataset declaring either mode: FROM "a replay inserts these again" TO a note that the mode is retired, that a replay refuses the dataset, and what to declare.
- the advisory lint rule `seed-insert-mode-duplicates-on-replay` (`validateSeedReplaySafety`, `@objectstack/lint`): FROM a warning on `mode: 'insert'` TO removed; the schema refusal does its job for both modes. The author-time rule count `os validate` / `os build` print goes from 70 to 69.
- the save door's and the loader's hint for a key no record carries: FROM "or use mode 'insert' for rows with no natural key" TO a list of fields when no single field names a row, or `'id'` when the records carry their own ids.

The fix: declare which field identifies a row and drop the mode (or declare `upsert` for reference data the package keeps current). Set `externalId` to the field that names a row, to a list of fields when no single field does (a junction table's `['team', 'project']`), or to `'id'` when the records carry their own ids. Rebuild the package, and reinstall it where it was installed with `os package install`, so the stored body carries the new declaration.

No conversion is made, at load, at save or by a migration (ADR-0087 D3, entry `seed-mode-insert-replace-retired`): a keyed mode needs the field that identifies a row, and only the author knows it. Rows earlier replays duplicated are data and are left as they are.

Unchanged: `ignore`, `upsert` and `update` datasets load byte-identically.
