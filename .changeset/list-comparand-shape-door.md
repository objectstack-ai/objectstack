---
"@objectstack/spec": patch
"@objectstack/objectql": patch
---

fix(spec): enforce the list-comparand rule at the shared compile face, so a scalar `in`/`nin` no longer reaches a driver (#9228)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
added, renamed, retired or tombstoned. The change moves an existing runtime rule
from `@objectstack/objectql` to `@objectstack/spec` and calls it from
`parseFilterAST`; the authorable metadata surface is byte-identical. -->

`FieldOperatorsSchema` has always declared `$in` / `$nin` as `z.array(z.any())`
and `$between` as `z.tuple([min, max])`, and #5869 / PR #6209 built the gate that
enforces it — but only at `@objectstack/objectql`'s lowering seam. That covers
every query reaching a driver **through the engine** and nothing else. A caller
that lowers a filter with `parseFilterAST` and calls a driver directly — an
embedder, and this repo's own driver conformance suites — met no gate at all:
`parseFilterAST([['name', 'notin', 'alpha']])` returned `{ name: { $nin:
'alpha' } }`, a shape the contract forbids, and handed it over.

That path was carried by mingo's own coercion of a non-array `$in`/`$nin`
operand. mingo 7.2.3 removed the coercion, so from 7.2.4 on the same input
escapes as an unhandled third-party `TypeError: b.filter is not a function` —
no `code`, no `status`, no field name — straight to the caller. It is the sole
failure blocking the `mingo` 7.2.2 -> 7.2.4 bump.

**Fixed at the shared face, with exactly one implementation.** The rule now
lives in `@objectstack/spec`'s `data/filter-comparand-shape.ts`, the same place
the comparand-TYPE door (#7872 / PR #8234) was promoted to for the same reason
("enforced once at the shared compile face for all five drivers"), and
`parseFilterAST` runs it on everything it returns — shape first, then type, the
order the engine's own seam already applied. `@objectstack/objectql`'s
`assertListComparandShapes` is now a delegating wrapper whose only remaining job
is the engine's `find('deal'): ` caller prefix; no driver was patched (both
driver families are under the #5499 investment freeze).

**The accept/reject delta is narrow and one-directional.** Newly refused, with
the ADR-0112 `INVALID_FILTER` / 400 envelope: a non-array `$in` / `$nin`
comparand and a non-`[min, max]` `$between` comparand, reaching a driver via a
direct `parseFilterAST` call. Nothing else changes — every filter the engine
accepted still lowers byte-identically, `$in: []` / `$nin: []` remain legitimate
declared predicates, list MEMBER types stay unjudged here, and a field spec with
no `$` key is still not descended into. The same inputs were already refused
with the same envelope on every engine verb and at the REST ingress, so no
authored metadata in the repo or in `objectui` produces a shape that newly
fails: a survey of `examples/**`, `content/docs/**`, fixtures, seeded platform
objects and objectui's view definitions found every membership rule already
carrying an array.

`parseFilterAST` gains an optional second argument, `context` — the caller
prefix both doors in `@objectstack/spec` already take. It is additive and
defaulted; existing calls are unaffected.
