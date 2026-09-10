---
"@objectstack/formula": minor
"@objectstack/lint": minor
---

fix(formula): the strict declaredness env declares `SCOPE_ROOTS` as `dyn`, so a bare reference behind a root name is no longer masked (#16412)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: no `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every view, form, flow and formula parses byte-identically to before. `objectstack migrate meta` therefore has nothing to rewrite, and this changeset carries no rewrite instructions. What narrows is the ACCEPT SET of published CHECKERS at build time: `validateExpression` and two `@objectstack/lint` rules now report a bare field reference they previously left unjudged, which is the same verdict each of them already returns for that identifier when it is written first in the same predicate. The sources that newly report are already broken at RUN time and were before this change: a bare identifier in a record-scoped site resolves to nothing, the expression evaluates to null and a visibility predicate falls open, which is #1928's class. The remedy is per-source and the diagnostic already names it in full, naming the identifier and the namespace it belongs under; there is no authored artifact and no stored representation for a migration to act on. -->

**BREAKING** in the accept-set sense — an accept-set narrowing on published
CHECKERS, in the same sense as a route that starts refusing a request it should
always have refused — landing in the launch window as `minor` on both packages (during the window the bump level is
not the carrier of breaking-ness; this paragraph and the disposition above
are). Nothing that was already reported stops being reported, and no source
that is correct starts being reported.

`firstUndeclaredReference` asks cel-js's checker for the first undeclared
identifier in a source. That checker returns exactly ONE error, and the helper
acts only on `Unknown variable: X`, so whenever the first error is of another
class every undeclared reference behind it in the same source went unjudged and
the helper answered `null` — which is also the value that means "every
reference is rooted". Four published call sites read that answer, and none of
them can tell the two readings apart.

The widest way to reach that state was a disagreement between two environments
in this package about the same names. The strict env declared every
`SCOPE_ROOTS` member (`data`, `config`, `record`, `result`, `item`, `event`,
`input`, `user`, …) as `map`, while the permissive env that `celEngine.compile`
type-checks in leaves them `dyn`. `map` has no `==`, `<` or `+` overload, so an
ordinary comparison on one of those names compiled clean and then faulted `no
such overload` in the strict env only — taking the single error slot and
silencing everything behind it. An author reaches it by naming an object field
or a flow variable after a namespace root and reading it bare, which on a
metadata-editing form is not even a coincidence: that layer binds the row under
edit as `data`.

The strict env now declares those roots `dyn`, which is what the list's own
doc-comment already claimed it was for — member access, arithmetic and
comparison on a root all deferring to runtime — and which `map` delivered only
the first of. The two environments agree about these names, so the class cannot
arise rather than being compensated for downstream.

What starts reporting, measured on each published surface:

- `@objectstack/formula` `validateExpression` with `scope: 'record'` — a bare
  reference behind a root name is the hard error it always was for the same
  identifier written first (`ok` was `true` with zero errors; it is now `false`).
- `@objectstack/formula` `validateExpression` with `scope: 'flattened'` — the
  did-you-mean warning reaches a misspelled field behind a root name.
- `@objectstack/lint` `visibility-bare-identifier` — a bare identifier behind a
  root name in a `visibleWhen` predicate is a finding. Per that rule's own
  message the console otherwise falls open and the element renders
  unconditionally.
- `@objectstack/lint` flow-variable shadowing — a shadowed field read behind a
  root name is warned. That rule's documented blind spot is now name-local, as
  its wording always claimed: the colliding name itself is still not reported.

⚠️ One published answer also WIDENS, and it is not a reporting surface.
`inferExpressionType` (`@objectstack/formula`, re-exported from the package
root; read by `@objectstack/mcp` as `validate_expression.inferredType`) infers a
formula's coarse value type through `inferCelType`, which shares this same
strict environment. While the roots were `map` there was no `==`, `<` or `+`
overload for them, so an expression using a namespace root as a DIRECT OPERAND
did not type-check at all and the answer was `'unknown'`. With the roots `dyn`
those expressions type-check and the answer is the truthful CEL type:
`result + 1` and `record ? 1 : 2` → `'number'`, `record == "x"` → `'boolean'`,
`data == "x" ? "a" : "b"` → `'text'`, uniformly for every name on the list. No
answer changes from one concrete type to another and nothing narrows to
`'unknown'` — `size(record)` and `"a" in record` still answer, and a root that
is only the base of a member access (`record.amount > 100`) never consulted this
declaration. A consumer that keys off a concrete type therefore sees strictly
more expressions classified, never a different classification; for the
motivating consumer that means a formula written as `data == "x" ? "a" : "b"` is
now correctly seen as text rather than as unprovable. Pinned on both sides in
`validate.test.ts`.

⛔ Two first-error classes are NOT closed by this, and both stay pinned. A CEL
TYPE name (`type`, `string`, `int`, …) is declared by CEL itself, so no
declaration this package makes can reach it; measured on the strict env, the
message for `type == 'grid'` is byte-identical under a `map` and a `dyn` root
declaration. And `has()` handed a non-select argument still faults its own
class, which `@objectstack/lint`'s visibility rule masks at its own call site
(#16118) and which nothing else masks.

The narrowing this helper is built on is unchanged: it still acts only on
`Unknown variable`, so `type(record.x) == string`, comprehension macros, guard
idioms, optional chaining and stdlib calls report nothing, and a widening of
that regex onto the overload message remains refused.
