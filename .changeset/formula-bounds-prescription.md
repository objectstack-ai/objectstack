---
'@objectstack/formula': patch
---

`validateExpression`: give an over-budget expression a SIZE prescription instead of the dialect trailer (#7073)

ADR-0032's shared validator appended one trailer to every `celEngine.compile`
refusal, byte for byte — `— predicates are bare CEL (e.g. \`record.rating >= 4\`).`
That sentence is right for a dialect mistake and actively wrong for a **bounds**
refusal: an 80-clause conjunction is already bare CEL, perfectly good syntax, and
merely over the platform's parse budget. The author was told to change the one
thing that was never wrong; an AI author, which obeys the last sentence it was
handed, rewrites the dialect and regresses. Reported by #6833's measurement.

The refusal is unchanged — same inputs refused, same `Exceeded maxAstNodes (256)`
front half from cel-js. Only the prescription is now class-aware: a `bounds`
verdict (read off the engine's own `error.kind`, with the exceeded bound named by
`parseCelToAstWithReason`) produces

> invalid CEL predicate: Exceeded maxAstNodes (256) … — this is valid CEL that
> exceeds the `maxAstNodes` budget (limit 256) — a SIZE fault, not a dialect
> mistake, so re-spelling the expression will not fix it. Shrink it (fewer
> clauses, shallower nesting, fewer list elements), or precompute the heavy part
> into a stored field and reference that field instead. …

while a genuine dialect/syntax fault keeps the old trailer verbatim. Fixed once at
the producer, so all ~10 expression slots benefit — build, metadata registration,
lint's `validateStackExpressions`, and the `validate_expression` tool. The
remedies are deliberately slot-generic: the slots' combination semantics differ,
so PR #6831's RLS-specific "splitting the top-level `&&` widens the grant" is not
portable and splitting is offered only with a caveat.

Also documents, text-only, the completeness gap in `cel-pushdown-limits.ts`'s
"nothing else needs to move at GA": a third lint gate (`validateStackExpressions`)
covers the same `sharingRules[].condition` and is mode-agnostic, so during the
rc grace window lint is stricter than the runtime — benign, tightening-direction,
and self-healing at GA. No behaviour change there.
