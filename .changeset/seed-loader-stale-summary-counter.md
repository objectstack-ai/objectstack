---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

fix(seed-loader): a roll-up summary left stale by a seed is now loud and counted

The loader recovers a post-write roll-up summary recompute that exhausts its
retries (`ERR_SUMMARY_RECOMPUTE`), and that recovery is correct: the rows WERE
written, so re-writing them would duplicate them (framework#3147). What was
wrong was the rank of the consequence. A roll-up summary is a **persisted
derived column** on the parent record, so after this the database is internally
inconsistent — the detail rows say one thing and the column that summarizes them
says another — and nothing recomputes it until some later write happens to touch
the same parent, which after a seed may never happen.

The entire event used to be one `warn` line reading *"records were written
(summary values may be stale)"*. It named no object, counted nothing, and left
`success: true` with every row counter clean, so no operator could see which
aggregate was wrong and no caller could detect it at all
([#4998](https://github.com/objectstack-ai/objectstack/issues/4998)).

**It now logs at `error`**, naming the seeded object and the exact stale column
(`account.total_billed`), stating the consequence (the summary and its detail
rows disagree, nothing self-heals, and the seed still reports success) and the
remedy (fix the recompute error and re-run the seed, or trigger any write on the
affected parent to force a recompute), with the original cause attached. This is
the AGENTS.md "Degradation log levels" rule (#4632): persisted state and runtime
state disagreeing while everything looks normal is `error`, not `warn`.

**And it is counted** — `SeedLoadResult.summariesStale` and
`SeedLoaderResult.summary.totalSummariesStale`, mirroring `referencesDropped` /
`totalReferencesDropped`, which exists for the same shape one layer down ("the
row was written, something derived from it was lost"). A log line is not
something a caller can branch on; these counters are.

`success` deliberately stays `true`. It answers *"did the rows land"*, and they
did — every consumer treats `success: false` as "the write failed", so flipping
it would hand the protocol seed-apply surface a `false` with an **empty** errors
array and fail package/marketplace installs that in fact wrote every row. The
counter carries the signal instead; a caller that wants to treat a stale
aggregate as fatal reads `summary.totalSummariesStale > 0`.

Both counters are additive with a `0` default, so an existing producer or
consumer of `SeedLoaderResult` is unaffected — a payload written before this
release still parses, with `0`.
