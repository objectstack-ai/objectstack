---
"@objectstack/spec": minor
---

feat(spec): the settings-manifest `visible` slots declare the grammar they are actually evaluated with, instead of claiming CEL (#7327, the alignment half of #7169)

Both `visible` slots on a settings manifest — specifier-level and
manifest-level — were typed `ExpressionInputSchema`, the shared expression
input whose bare-string arm normalises to `dialect: 'cel'`. Nothing has ever
evaluated them as CEL. Their only two readers are the console's client-side
`new Function(...)` over the raw string and, since #7310, the server-side
`evaluateVisibility` in `@objectstack/service-settings`, which implements a
deliberately tiny closed grammar. So the declared dialect and the evaluated
dialect disagreed, and the disagreement was **not** cosmetic: `===` and `!==`,
which the bundled manifests use throughout, are not CEL operators at all.

**The measurement decided which side moves.** #7169 counted the corpus — 94
`visible` predicates across the 10 bundled manifests, 27 distinct sources.
Wiring the *declared* CEL into evaluation breaks **93 of 94**, syntactically
and totally, plus every manifest stored outside this repo. Narrowing the
*declaration* to the grammar already evaluated breaks **1**, and #7310's
relational-operator extension had already absorbed that one, taking it to
**0**. The maintainer's 2026-08-10 ruling took the second direction, and
#7071's ruling on `ExpressionInput` ("each protocol keeps its own spelling")
named this narrowing as the follow-up.

**After:** both slots accept the grammar the evaluator implements and nothing
else — a single root `data` with one level of member access, the operators
`||` `&&` `!` and `===` `!==` `==` `!=` `>=` `<=` `>` `<`, parentheses, and
string / number / `true` / `false` / `null` literals, optionally wrapped in
`${…}`. A bare string and a `{ dialect, source }` envelope are both still
accepted, and a bare string still normalises to the canonical envelope, so
**the wire shape does not move** — only the set of accepted `source` strings
narrows.

An author who reaches for real CEL is now told so where it is cheap to fix:

```
Unsupported `visible` predicate "data.provider in ['smtp', 'resend']":
unsupported identifier "in" — the only root is `data`. A settings `visible`
predicate is not CEL: … Rewrite CEL membership as an `||` chain
(`${data.x === 'a' || data.x === 'b'}`); function calls, macros and member
paths deeper than one level have no equivalent here.
```

Previously that predicate passed every publish-time gate and then failed the
tenant's next save — and before #7310, did not even fail: it silently switched
off `required`, `options`, `pattern`, `valueDomain` and the value window on its
key. #7310's save-time refusal stays exactly where it is, as defense in depth:
this is the producer-side check, that is the consumer-side check.

**The two sides are pinned to each other**, because a second statement of one
grammar is exactly the drift that caused #7169 in the first place.
`service-settings/src/settings-visibility-declaration.pin.test.ts` asserts that
"the schema accepts it" and "the evaluator can parse it" are the same bit, over
an in-grammar / out-of-grammar table *and* over the real bundled corpus — which
it re-measures at 10 manifests / 94 predicates, 0 refused.

**Upgrading:** every bundled manifest is unaffected (measured, 0 refusals). A
third-party manifest is affected only if it carries a `visible` predicate the
save path already could not evaluate; the refusal names the predicate, the
reason and the supported grammar. `minor` rather than `major` follows the
repo's precedent for narrowing acceptance on one authorable key
(`action-param-strict-unknown-keys`, `chart-aggregate-groupby-strict`) — this
removes no authorable surface with reachable behaviour, so it is not the
`major` class of #6188 / #6815.
