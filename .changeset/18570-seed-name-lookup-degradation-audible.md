---
"@objectstack/plugin-security": patch
---

`seed-name-lookup.ts` — the batched seed existence read's OWN failure now reaches the author when no logger was injected, through the one delivery derivation the package already owns (#18570).

The oracle every declared-metadata seeder consults hoists one `$in` read out of its loop and degrades to the per-item read when that read cannot answer — an outage, or a page proven to be a prefix of the answer. It reported that degradation through a doubly-optional `logger?.warn?.(…)`, which evaluates to NOTHING when the caller injected no sink: the read failed, the pass silently switched to the slow path, and no human was told.

Measured differentially rather than read off the code, in this package's own `bootstrap-declared-capabilities` control harness: an unreadable-database pass with **no logger** printed exactly **one** author-visible line — the seeder's own end-of-pass summary — while the batched read that failed *first* said nothing. With this change the same pass prints **two**, and that assertion is now the pin (`toHaveLength(1)` → `toHaveLength(2)`, both lines selected by content).

- **Delivery only.** The wording, the structured meta (`object`, `names`, `rowBudget`, `organization`) and the two named causes — `unreadable` and `truncated` — are axis-specific and stay at the call site, which is the split `seed-refusal-sink.ts` documents. ⛔ No sixth hand-written copy of the rule, and ⛔ no generic refusal sentence.
- **A read that ANSWERED stays silent on every channel**, with or without a sink — the discriminating control that keeps a healthy boot quiet.
- **It also stops a throw.** `logger?.warn?.(…)` guards `null`/`undefined`, never a non-callable `warn`: a host that declared one and shipped something else raised `TypeError: logger?.warn is not a function` *inside* the degradation path, turning a slower read into a failed boot. The site now asks `typeof` — the same question `reportThroughSink` asks — so such a host takes the console arm instead.
- **No exported surface moves.** `seed-name-lookup.ts` is package-private (`src/index.ts` re-exports nothing from it) and `SeedLookupLogger` is unchanged, both members still optional.
