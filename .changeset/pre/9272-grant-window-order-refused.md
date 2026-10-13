---
"@objectstack/plugin-security": major
---

`sys_user_permission_set` refuses an assignment whose validity window ends at or before it starts (ADR-0091 D1/D2)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of one stored value combination on a data object; no metadata key, export or authorable surface moves, so `objectstack migrate meta` has nothing to rewrite -->

**BREAKING**: an accept-set narrowing on the data door, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

- **What is refused.** A write that leaves an assignment with both `valid_from` and `valid_until` set and `valid_until` at or before `valid_from` is refused with `400 VALIDATION_FAILED`, a `rule_violation` at `valid_until`. The window is half-open, `[valid_from, valid_until)`, so such an assignment can never grant anything: the resolver drops it at every evaluation. Until this release it was stored without a word, so an administrator who mistyped a date got an assignment that silently granted nothing.
- **Which writes are judged.** Every insert, from every writer, system writers included, single rows and batches alike. An update is judged by the stored row overlaid with the patch, and only when it moves a bound: by id, and for each matched row of a multi-row update. The refusal is a declared validation rule on the object, `validity_window_order`, so the engine runs it on every one of those write paths.
- **What still lands, unchanged.** A window that ends after it starts, one bound alone (either one), and no window at all. An update that moves neither bound is not judged, so an assignment stored before this release with an inverted window does not block an unrelated edit; the write that repairs it is the only one that has to state a valid window.
- **To fix a refused write**, set `valid_until` later than `valid_from`, or leave one of the two empty for an open-ended window.
