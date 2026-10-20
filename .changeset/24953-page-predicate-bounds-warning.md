---
'@objectstack/lint': minor
---

feat(lint): a CEL slot inside a page component's `properties` that overruns the platform's parse bounds is reported as a warning at `os validate`, `os build`, `os lint` and the page publish door

Clause-②: no

A source over `DEFAULT_LIMITS` (`maxAstNodes` 256, `maxDepth`, `maxListElements`) does not parse anywhere on the platform. It faults on every evaluation, and the console fails open, so the element it was written to gate draws for everyone. The component node's own `visibleWhen` was already refused for this (`visibility-predicate-over-budget`). The CEL slots declared inside the props bag were judged by no rule. These include a `page:tabs` item `visibleWhen`, an `object-form` section or inline field `visibleWhen` / `readonlyWhen` / `requiredWhen`, `record:alert` `visible`, and the `visible` / `disabled` of the `action:*` blocks. A page carrying such a slot saved clean through every door.

The new rule `page-predicate-over-budget` (`validatePagePredicateBounds`) reads the slots off each component's `ComponentPropsMap` row: every position where the row's parse produces a `{ dialect: 'cel', source }` envelope. It judges each one with `validateExpression`'s bounds verdict and names the key and the bound. It does not echo the source. It is a **warning** in 18.x: the page still saves and builds, and the publish door carries the finding on its `advisories` channel. A future major release refuses it. A within-bounds source draws nothing.

Fix: shrink the expression. Collapse an `||` chain into one `in [...]` test, or precompute the heavy part into a formula or roll-up field and test that field.
