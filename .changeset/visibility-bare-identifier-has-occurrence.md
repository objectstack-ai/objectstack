---
"@objectstack/lint": patch
---

`visibility-bare-identifier` now reports an identifier written bare beside a `has()` guard in the same visibility predicate.

`has(status) && status == "qualified"` published clean while `status == "qualified"` — the same defect, without the guard — gated at `error`. The guarded spelling is the one the totality discipline pushes authors toward, so an author who correctly adds `has()` and forgets the `record.` prefix on both halves landed in the silent row. That predicate never evaluates for any record, and an unevaluable `visibleWhen` on a form surface fails OPEN: the field renders and carries its `required: true` into the console's submit check.

The cause was not the exclusion a `has()` argument earns — that is correct and stays. `firstUndeclaredReference` reads the first error the CEL checker reports and acts only on `Unknown variable: X`; a bare `has(x)` fails that check with `has() invalid argument` instead, and a first error of a different class masked every undeclared reference behind it in the same predicate, whatever it was called. Each `has(…)` call is now masked out of the source before the checker sees it, using the canonical AST's own spans, so the argument occurrence is excluded and every other occurrence is judged exactly as it would be with no guard written beside it.

Expect new `error` findings on predicates that used to publish clean: a guarded-but-unprefixed `visibleWhen` on a view, page component or form section is now refused at build, validate and lint alike. That is the fail-open shape the rule exists to catch. A `has()` argument that is the only bare occurrence — `has(status)` on its own — stays silent, as it did before.
