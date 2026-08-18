---
"@objectstack/spec": minor
---

Declare the closed vocabulary of expression-bindable text keys (objectui#4795 Direction 1, spec half — #9599).

`@objectstack/spec/ui` now exports `EXPRESSION_BINDABLE_TEXT_KEYS` (`title` / `label` / `value` / `description` — a closed enum per the 2026-08-17 maintainer ruling's terms, reopened 2026-08-18), the `ExpressionBindableTextKey` type and `ExpressionBindableTextKeySchema` Zod face, the per-component carriage map `EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT` (`statistic`: `label`/`value`/`description`, `card`: `title`/`description`, `button`: `label` — measured against the objectui renderers' read points at the `.objectui-sha` pin), and the runtime lookup `expressionBindableTextKeysFor(componentType)`. These are consumed by the objectui SchemaRenderer evaluation memo (the downstream half, riding objectui#4795) so the set of top-level text keys the memo evaluates is declared here once, never inferred or hard-coded as a twin list. Purely additive — no existing schema accepts or rejects anything new in this release.
