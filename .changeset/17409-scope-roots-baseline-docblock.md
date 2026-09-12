---
'@objectstack/formula': patch
---

`SCOPE_ROOTS`'s docblock says it is a **baseline**, not a per-surface accept set, and points at where the per-surface verdict actually lives

The exported `SCOPE_ROOTS` constant carried a docblock that made **a false statement about itself**. Its opening line read *"Namespace roots that a `record`-scoped CEL site may legitimately reference"* — which, read alone, is exactly the per-surface accept-set reading. Ninety lines below, the companion block asserted *"This list is a 'never faults' BASELINE, not a per-surface contract — **the doc-comment above says so**"*. The doc-comment above did not say so; it said close to the opposite.

**This is not a docs nit, and the evidence is a card.** The accept-set reading is what a downstream seat took away, and it generated a cross-repo card filed against this package (this one) about a lint/runtime disagreement that is not a disagreement at all: the baseline declares a root, the per-surface gate refuses it, and both are correct.

- **The opening line now states the contract it actually is**: the roots the strict check env declares, so that naming one is never itself a fault — and explicitly ⛔ *not* a claim that any surface **binds** the root.
- **It points at the per-surface authority by name**: `@objectstack/lint`'s `fieldRuleRootIssue`, judged against that surface's own closed `FIELD_RULE_BOUND_ROOTS` (`record` / `previous` / `parent`). A reader asking "may THIS surface reference this root?" is now sent one hop to the symbol that answers it, instead of reading the answer off this list.
- **It names `data` as the standing example** of a root this list declares and the field-rule surface does not bind — the two answers doing their separate jobs, ⛔ not something to repair by editing this list.
- **The self-reference is now true.** The companion block cites `SCOPE_ROOTS`'s own doc-comment, which now opens by saying exactly what the citation claims it says.

⛔ **Zero behaviour change.** `SCOPE_ROOTS` keeps all **27** members, byte for byte — no member is added, removed or reordered, and ⛔ `app` is not added (objectstack#16420 closed `not_planned` on that and this does not reopen it). Narrowing was refuted by measurement rather than by preference: six `*.form.ts` metadata-form modules in this repo carry live `data.` predicates. The diff is comment lines only.

**This publishes, which is why it is `patch` rather than `skip-changeset`.** `@objectstack/formula`'s `files[]` ships `dist`, and this TSDoc is emitted into the built declarations — measured on the built artifact at three readings: the new text's distinctive phrase present at 1 in both `dist/index.d.ts` and `dist/index.d.mts`, an untouched neighbouring sentence from the same docblock present at 1 as the lit control, and a fabricated phrase at 0 as the dark control. The companion block is a plain `/* */` comment attached to no declaration and reads 0 in `dist` — it is the half that does not ship, and the half that does is the half that was wrong.
