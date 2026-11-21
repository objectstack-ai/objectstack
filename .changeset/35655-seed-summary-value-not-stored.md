---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a seed never stores a roll-up (summary) value; the children compute it, and the load result counts the drop

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered seed-summary-value-not-stored -->

**BREAKING** for a seed record that supplies a value for a `summary` (roll-up) field, in any seed: a `defineStack({ data })` dataset, `defineSeed`, a `seed` metadata item, or the seed data a package install loads. Every aggregate (`count`, `sum`, `min`, `max`, `avg`) is treated the same, whether or not the field is declared `readonly`.

- FROM: the seed loader writes as the system principal, so the supplied value was stored as written. It stayed wherever no child write came after it: a parent seeded with a total and no children kept the total; a re-seed over existing children wrote it over the computed value; and a keep-current (`upsert`) seed replayed on the next boot stored the computed total on the first load and the supplied one on the second.
- TO: the loader takes every such value out of the record before the replay compare and the write, on insert and on update, and writes the rest of the record. A created row starts the column at its empty-child-list value (`0` for `count` and `sum`, empty for `min`, `max` and `avg`), and the seeded child rows compute it. A matched row keeps the value it holds, so a replay whose only difference is the roll-up writes nothing. A parent seeded with a total and no children now reads `0`.
- Reported, not silent: each dataset's load result carries the new counter `summariesDropped` (the values it did not write), the load summary carries `totalSummariesDropped`, and the load logs one warning per dataset naming the object, the fields and the count. `success`, `errored` and the row counters do not move. A dry run (`validate`) reports the same count.

Compatibility note for seed authors: to show a total, seed the child rows it is computed from and leave the summary field out of the parent's seed record. A figure no child rows back is not a roll-up: declare it a `number` or `currency` field. A legacy total that must land as written goes through a historical import (`treatAsHistorical: true`), which is unchanged. Rows an earlier load stored a supplied total on are not rewritten by the loader; the next child write recomputes them.

Also new on `SeedLoadResultSchema` / `SeedLoaderResultSchema`: `summariesDropped` and `summary.totalSummariesDropped`, both `.default(0)`, so a payload written before them still parses. A hand-written `ISeedLoaderService` implementation that builds a `SeedLoaderResultParsed` literal now also sets `summary.totalSummariesDropped`.

Not changed: the engine (`packages/objectql`), which still keeps a value an `isSystem` write sends (the roll-up recompute, the backfill, a historical import); the import and REST doors; and the runtime's basic-insert fallback seeder, which runs only when the seed loader is unavailable or throws.
