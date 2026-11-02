---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: two granularities of one time dimension are refused on every face, not collapsed to the last one

Clause-②: no (narrowing) — `timeDimensions` naming one dimension, spelled the same way, at two granularities (`[{ dimension: 'closed_at', granularity: 'month' }, { dimension: 'closed_at', granularity: 'year' }]`) is now refused `INVALID_QUERY` / 400 on the native strategy, the ObjectQL strategy and the draft preview, with the refusal each already gives one column asked twice under one name (#28765); every face served it as the last granularity's buckets and dropped the other entry. Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a selection that was half served is refused with a refusal already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on `queryDataset` (`@objectstack/service-analytics`), on every face.

- **Before.** Measured on real SQLite: the pair above answered one `2026` row holding the whole total on all three faces (the `month` entry dropped silently); `year` then `month` answered the months (the `year` entry dropped). Beside the raw dimension `closed_at`, both live faces answered one `1970-01` bucket holding the whole total.
- **Now.** The ObjectQL strategy's group-key builders keep every granularity a dimension is asked at, so the engine sees both buckets of the one column and answers its duplicate-column refusal, which the native strategy relays for a bucketed selection; the draft preview judges the same keys and gives the same refusal, field for field. This holds beside other dimensions and beside a cross-object dimension.
- **Unchanged.** One dimension asked twice at the same granularity is one bucket and is served. One bucket per column, and buckets of different columns, are served. No new refusal is added; the existing one now sees the pair.
- **Who sees it.** A caller sending two granularities for one time dimension: a refusal saying the column is asked twice, instead of a chart missing one of them.

**The remedy.** Ask each time dimension at one granularity.
