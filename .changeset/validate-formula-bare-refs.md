---
"@objectstack/formula": patch
"@objectstack/cli": patch
---

feat(validate): flag bare field references in record-scoped CEL sites at build time

A `Field.formula` and an object validation predicate evaluate against the
`record` namespace only — there is no field flattening — so a bare top-level
identifier (`amount`, `status`) resolves to nothing and the expression silently
evaluates to `null` / never fires. This is the silent-at-runtime class behind
the broken example-crm formulas (#1927) and is exactly what AI authors get wrong.

`validateExpression` now takes an evaluation `scope` and, for `scope: 'record'`,
reports a bare reference with the corrective form (`write record.<field>`). The
check is schema-free and acts only on cel-js's `Unknown variable` fault, so it
cannot false-positive on arithmetic/comparison/null-guard type overloads. Flow
and automation conditions keep the default `scope: 'flattened'` — the record's
fields ARE spread to top-level there (alongside flow variables), so bare refs
are correct and are NOT flagged. `objectstack compile` wires `record` scope for
field formulas and validation predicates; flow conditions stay flattened.
