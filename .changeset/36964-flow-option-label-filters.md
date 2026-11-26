---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint)!: `os validate` and the publish gate refuse an option label in a flow's query filter, edge condition or decision branch

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37504

<!-- adr-0087: not-required (already-registered publish-refuses-flows-that-save-and-do-not-run) the same option-label refusal at more positions of the same flow; this change extends that entry's surface from the start condition to an edge condition, a decision branch and a query filter operand, at the same doors (os validate / lint / compile / build and the runtime publish gate) -->

**BREAKING** accept-set narrowing, shipped as `minor`: a flow carrying one of the shapes below was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored flows are not rewritten or refused at boot; the refusal comes at the next publish of the flow, and from `os validate` / `lint` / `compile` / `build`. No export is added or removed.

A select field stores the option's value, never its label, and a flow hands its filters and conditions to the data engine and the expression engine as written: nothing resolves a label to its value there. So `filter: { stage: 'Closed Lost' }` on a `get_record`, `update_record` or `delete_record` step matched no row, and the step reported success having read, updated or deleted nothing; an edge condition or `decision` branch `deal.stage == 'Closed Lost'` was never taken. `flow-condition-option-label` read only the start condition, so nothing said so.

- **The refusal.** `flow-condition-option-label` (`error`, as on the start condition) now also reads:
  - each operand of a `get_record` / `update_record` / `delete_record` `filter`, and of a time-relative sweep's `timeRelative.filter`: a field's implicit equality, its `$eq` / `$ne` comparand and each member of its `$in` / `$nin` list, at the top level or under `$and` / `$or` / `$not`, at any region depth;
  - every edge condition and every `decision` node's `conditions[].expression`, at any region depth, where it compares a select field of the trigger record (`record.F`, `previous.F`, or a bare `F`) on a record-change or time-relative flow, or of the row a single-row `get_record` step (`limit` absent or 1) bound to its `outputVariable` (`deal.F`).
- **Not judged.** A CEL value envelope, a variable or a template operand or comparand; a field whose options come from a shared picklist; a variable that anything else in the flow also binds (another step, a declared variable, a node id, a screen field); a `record` / `previous` root the flow rebinds itself; a bare `F` that such a binding shadows. A `readonly` select is still judged, as the start condition already judges it.
- **Escape, filters only.** A filter that is meant to find rows still holding a label (a clean-up after the options changed) writes the operand as a CEL value envelope, `{ dialect: 'cel', source: "'Closed Lost'" }`, which is evaluated before the query and not judged. An edge condition or a `decision` branch has no such escape: compare the value.
- **What carries it.** The ADR-0087 entry `publish-refuses-flows-that-save-and-do-not-run` now names the edge condition, the `decision` branch and the filter operand beside the start condition.

FROM → TO:

- `filter: { stage: 'Closed Lost' }` → `filter: { stage: 'closed_lost' }`
- `deal.stage == 'Closed Lost'` (an edge condition or a `decision` branch) → `deal.stage == 'closed_lost'`

One-line fix: write the option's value where the label is, as the finding names it.
