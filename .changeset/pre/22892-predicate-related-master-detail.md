---
'@objectstack/objectql': minor
---

fix(objectql)!: a validation rule that reads its master through a master-detail field asks the caller's read door for the header first — a header the caller cannot read is unavailable to the rule as a header that exists nowhere is (#22892)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. A rule that loaded before keeps its authored shape. What narrows is one runtime read: the related read of a `script` / `cross_field` rule that reads one hop through a `master_detail` field (`record.<field>.<column>`) now asks the caller's read door for the header before its elevated read, so a header the caller cannot read is answered as a header that exists nowhere. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A detail write answers a header the caller cannot read exactly as a header that exists nowhere: its `parent` binding and its reference check ask the caller's read door first (the companion entry for #22519). A validation rule on the detail that reads the header through the master-detail field (`record.invoice.status == 'locked'`) still read the header elevated, and rules run before the reference check, so that rule could still answer by what an unreadable header holds.

**FROM.** For a non-system caller who may write the detail but cannot read its header, a rule reading the header through the master-detail field judged the header's stored values. Measured with a rule refusing a line under a locked invoice: a header id that exists nowhere was refused with `_record` `rule_violation` ("the related record was not found"); an unreadable open header passed the rule and was refused `reference_not_found`; an unreadable locked header was refused with the rule's own message. Three answers, one bit of the header's state.

**TO.** Through a `master_detail` field the rule's related read takes the write's two reads:

1. The caller's read door, under the caller's own context. A header it does not return (hidden by row scope, a refused read of the header object, or a failed read) is unavailable to the rule exactly as a header that exists nowhere is: the rule cannot be evaluated and the write is refused `400 VALIDATION_FAILED` at `_record` (`rule_violation`, "the related record was not found"), whatever the header holds.
2. The elevated, tenant-kept read of the columns the rule names, only for the headers step 1 returned. A header the caller can read is still judged on its STORED values, a column field-level security hides or masks for the caller included.

**Bindings.**

- Every write door that runs the rule: `insert` (single and batch), `insertMany`, update by id (a repoint included), the predicate (bulk) update, and the `validate()` preview.
- System callers (`isSystem`: seed replay, boot, package install) ask no read door and are judged exactly as before.
- A rule reading through a plain `lookup` is unchanged.
- No new error code and no status change: the answer is the one a header that exists nowhere already got.
- Cost: one id-projected read under the caller's context per master-detail field a rule reads through, once per write batch.

**Fix, if a write relied on the old answer:** give the writer read access to the header (an object permission or sharing rule on the master), or declare the detail `controlled_by_parent` so the header's access governs it.

**Not measured.** How many deployed detail objects carry a rule reading their master was not measured: the rule only tightens, so it holds whatever that answer is.
