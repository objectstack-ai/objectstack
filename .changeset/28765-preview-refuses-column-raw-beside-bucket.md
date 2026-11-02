---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the draft preview refuses one column asked raw beside its own time bucket, as the live faces do

Clause-②: no (narrowing) — the draft preview (`queryDataset` with `previewDrafts: true`) now refuses `INVALID_QUERY` / 400 a selection that asks one column for two values under one name (a dimension `X` beside a `timeDimensions` entry `OBJECT.X` with a granularity, or two buckets of one column), with the message, `path`, `param`, `object` and `fields` the native and ObjectQL strategies already answer; it served both columns. Nothing is widened: no export, answer member, error code or status is added, and the code was already on the wire.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a selection both live faces already refuse is now refused by the draft preview too, with their refusal. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `queryDataset` draft preview (`@objectstack/service-analytics`).

- **Before.** Measured on real SQLite: `dimensions: ['closed_at']` with `timeDimensions: [{ dimension: 'OBJECT.closed_at', granularity: 'month' }]` was refused by both live strategies with the engine's duplicate-column refusal (`groupBy.1.field names the column 'closed_at', which groupBy.0 already names`), while the draft preview answered one row per raw timestamp carrying both columns. The same held for a month and a year bucket of one column.
- **Now.** The preview judges the keys the ObjectQL strategy would hand the engine for the selection, at the same positions, and refuses with the engine's refusal for them, so all three faces answer one `INVALID_QUERY` / 400 with one message.
- **Unchanged.** A raw dimension beside a bucket of a different column, a dimension that is also its own time dimension (one bucket), and two dimensions over one column with no bucket (#28744) are still served on every face. The live refusal does not move.
- **Who sees it.** An author previewing a draft dataset with such a selection: the preview now says what publish would say, instead of a table publish refuses.

**The remedy.** Ask for the column once: as the bucketed time dimension, or as the raw dimension.
