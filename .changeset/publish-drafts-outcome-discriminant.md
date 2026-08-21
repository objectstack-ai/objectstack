---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

Declare `outcome: 'published' | 'refused' | 'nothing_to_publish'` as a required
key on the `publishPackageDrafts` response (#10462) — the first-class
discriminant for WHICH exit answered, the fact `success` compresses into one
boolean. Before this field, a publish with nothing to promote and a genuine
refusal (pre-flight violation or ADR-0067 D2 rollback) were indistinguishable:
both answer `success: false` with `publishedCount: 0` on a 200, and the no-op
left no trace at all — an AI consumer graded the no-op as "refused and rolled
back" and burned two repair rounds on artifacts that were already correct
(cloud#1488; cloud#1492's patch discriminates on `failed.length > 0`, an
invariant the producer never stated).

The producer invariants, now stated and pinned in the conformance suites, both
directions of each: `outcome === 'refused'` ⟺ `failed.length > 0`;
`outcome === 'nothing_to_publish'` ⟺
`published.length === 0 && failed.length === 0`;
`success === (outcome === 'published')`. `success` keeps its exact pre-#10462
value on every exit — a no-op still answers `success: false` — so consumers
reading only `success` see no change, and cloud#1492's `failed.length`
discrimination stays valid during its convergence onto `outcome`. The no-op
exit additionally logs one `info` line naming the package and both facts
(nothing pending, nothing refused), so that exit is no longer traceless.

Additive for response consumers. A custom protocol implementation that serves
`publishPackageDrafts` must now emit `outcome` on every return —
`PublishPackageDraftsResponseSchema` declares it required, and the conformance
suites treat a producer return without it as a drifted seam.
