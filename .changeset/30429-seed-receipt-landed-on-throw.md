---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': patch
---

fix(metadata-protocol,runtime): a seed load that throws part-way still reports `seedApplied.landed` for the datasets that finished before the throw

Clause-②: yes (widening: a thrown load's receipt carries `landed` for the datasets that finished, where it carried none)
Metadata-protocol: semantic

- **`@objectstack/spec`: `seedApplied.landed`** (both publish responses) now says what it covers on a load that threw part-way (`success: false` with `error`): only the datasets that FINISHED before the throw. The dataset that threw is not listed (its rows are in `inserted` / `updated`, its object in `error`). Absent `landed` now means the apply failed before any load ran, or the producer reports no ids; a throw before any dataset finished reports `landed: []`.
- **`@objectstack/metadata-protocol`**: `SeedLoadPartialWrites` gains `finished`, the finished datasets' `object` / `landedIds` / `insertedIds` in load order, and `applySeedBodies`' catch folds it through the same `seedAppliedLanded` projection (same two lists, same 200 cap) the returned path uses. `seedLoadPartialWrites` and `SeedLoadPartialWrites` are exported from the package root.
- **`@objectstack/runtime`**: the package-publish door's fallback seed apply reads the same `seedLoadPartialWrites` off a thrown load and reports the same `landed`.
- Why the dataset that threw is left out: its ids are only partly known when it throws. A batched insert whose response was lost may have committed rows whose ids never came back, so a list of the ids the loader did see would read as complete while missing rows.

Supersedes, in the same release: `.changeset/30348-seed-receipt-landed-ids.md` says absent `landed` means "not reported (a load that threw, or a producer that reports no ids)". After this change a load that threw part-way reports `landed` for its finished datasets; absent now means no load ran, or a producer that reports no ids.
