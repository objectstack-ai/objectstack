---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the delegated fallback face refuses a date bucket over a formula or a field that is not a date, as the engine face does (#29364)

Clause-②: no (narrowing) — a cube query (or `/analytics/sql` dry run) that `FallbackDelegateStrategy` hands to the host's fallback analytics service is refused `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity` when it buckets a `formula` field, or a field declared anything but a date or a datetime, with the engine face's refusal field for field, before the fallback service is called. It answered 200 with one `null` group before. Only a host that composes the fallback face sees the change; no shipped composition reaches it. Nothing is widened: no export, public member, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the analytics service's existing date-bucket door, already in front of the engine, the draft preview and the dry run, now also stands in front of the delegated fallback service. A refused query is fixed in the query (or by storing the value on a date or datetime field), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the analytics fallback face (`@objectstack/service-analytics`), for hosts that compose it.

- **Who sees it.** Only a host that composes the fallback face: `new AnalyticsService({ fallbackService })`, or `AnalyticsServicePlugin` capturing an analytics service registered before it (for example `MemoryAnalyticsService` from `@objectstack/driver-memory`) under a `queryCapabilities` override with `objectqlAggregate: false`. The default composition sends every bucketed query to the engine, which already refuses these, and is unchanged.
- **Before.** The fallback service folded the bucket itself and read no field type. `MemoryAnalyticsService` put every row into one `null` group for a `formula` bucket, and a `null` group beside whatever text parsed as a date for a `text` bucket, under an ordinary 200. The dry run handed back the fallback service's statement.
- **Now.** Both the query and the dry run answer the engine's refusal (`INVALID_FIELD` / 400, `param: 'groupBy'`, `path: 'groupBy.N.dateGranularity'`, the same message), and the fallback service is not called. The field's type is read from the host's `sourceFieldMeta`, which `AnalyticsServicePlugin` answers from the data engine.
- **Unchanged.** A date or datetime bucket is delegated as before. A host that wired no field types (`sourceFieldMeta`) is not judged, as on the draft preview and the dry run.

**The remedy.** Bucket a date or datetime field. For a formula, store the value on a date or datetime field written when its source changes, and bucket that.
