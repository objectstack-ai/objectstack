---
"@objectstack/spec": patch
---

**ADR-0137 makes field-rule predicate fault semantics part of the contract** (#17778): what SUBMIT and RENDER do when a predicate cannot run.

Clause-②: no

**The predicate fault-semantics contract is recorded, not enforced, by this release.** ADR-0137 states what a field-rule predicate does when it cannot RUN: at SUBMIT a faulting predicate refuses the write and names the field and the rule (D2); at RENDER visibility stays fail-OPEN, so a rule that could not run never hides a control and lets the form write `null` over a column the user never saw (D3); a blank or faulting GATE predicate is diagnosed, never a silent `true` (D4); and the evaluation helper's fallback stays freely specifiable (D5), because fault-to-flag and fault-to-throw both exist only because it is a parameter. Those are consequences CONSUMERS deliver — `packages/spec` carries no business logic — and they land in the ObjectUI half. D1's authoring refusal (an `ast`-only envelope and a blank `source` are refused at authoring) is ruled by decision batch #122 item 2 and ships with the evaluated-slot narrowing that owns it, under that change's own ADR-0087 entry.

**ADR-0089 gains an addendum, not a reopening.** It unified the `visibleWhen` / `visibleOn` / `visibility` family under one name; ADR-0137 owns what that family does when a predicate cannot run, and ADR-0089 itself is unchanged by this release.

**Not carried by this entry: the `cel` / `expression` return-type narrowing to `EvaluatedExpression`.** This card touched that signature too, but main shipped the identical narrowing first, under #18638 (card #15811) — see that release's own changeset for the `EvaluatedExpression` story and the TS2322 it fixes. Restating it here would announce, a second time, a fact this release has already shipped under a different entry.
