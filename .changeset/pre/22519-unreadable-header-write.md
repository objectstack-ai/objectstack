---
'@objectstack/objectql': minor
---

fix(objectql)!: a detail write asks the caller's read door for its master-detail header before judging it — a header the caller cannot read answers as a header that exists nowhere (#22519)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read, in two places: the write's master-detail header read (the `parent` binding) and the write's reference check of a `master_detail` field now ask the caller's read door before their elevated read, so a write naming a header the caller cannot read is answered as a write naming a header that exists nowhere. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A write of a master-detail DETAIL reads its header for two things: the reference check of the `master_detail` value the caller supplied, and the `parent` that a parent-scoped `requiredWhen` / `readonlyWhen` judges.

**FROM.** Both read the header elevated (row-level access bypassed, the caller's tenant kept), on the premise that the caller's right to write the detail settled its right to see the header. ADR-0055 §3 guarantees that only for a `controlled_by_parent` detail (its master-edit gate). For any other detail, a non-system caller who could write the detail but could not read its header met:

- a reference check that admitted the header id, where a header id that exists nowhere answers `reference_not_found`;
- a parent-scoped rule judged against the header's stored state, so the write's answer depended on a row the caller cannot read.

**TO.** The header is read in two steps, the shape `validate()`'s preview already uses:

1. The caller's read door, under the caller's own context, so every enforcement layer in the middleware chain answers it. A header it does not return (hidden by row scope, a refused read of the header object, or a failed read) binds as a missing header binds: the reference check answers `reference_not_found` (`400 VALIDATION_FAILED`), and a parent-scoped `requiredWhen` / `readonlyWhen` meets an unbound `parent` (the requirement is refused as unevaluable, the lock holds), exactly as for a header id that exists nowhere.
2. The elevated, tenant-kept read, only for the headers step 1 returned. A header the caller can read is still judged on its STORED values, a column field-level security hides or masks for the caller included. The preview's per-column masking stays the preview's own.

**Bindings.**

- Every detail, `controlled_by_parent` or not, on every write door: `insert` (single and batch), `insertMany`, update by id (a repoint included) and the predicate (bulk) update.
- System callers (`isSystem`: seed replay, boot, package install) ask no read door and resolve exactly as before.
- A plain `lookup`'s reference check keeps its elevated existence probe, unchanged.
- No new error code and no status change: the answers are the ones a header that exists nowhere already got.
- Cost: one id-projected read under the caller's context per header resolution (once per batch), and one per supplied `master_detail` value in the reference check.

**Fix, if a write relied on the old answer:** give the writer read access to the header — an object permission or sharing rule on the master, or declare the detail `controlled_by_parent` so the header's access governs it.

**Not measured.** Which deployed configurations let a caller write a detail whose header it cannot read was not measured: the rule only tightens, so it holds whatever that answer is.
