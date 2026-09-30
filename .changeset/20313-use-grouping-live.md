---
'@objectstack/spec': patch
---

The `field` liveness ledger grades `useGrouping` `live`, and the key's docblock stops describing a grouping heuristic the renderer does not use

Clause-②: no

A number field's authored `useGrouping` is honoured by the console this release builds against:
an authored `true` or `false` decides whether the value renders with thousands separators, and an
absent key keeps the renderer's interim rule. The `liveness/field.json` row therefore moves from
`planned` to `live`, citing the objectui reader and the sites that carry the key to the number
cell, and `liveness/state-counts/field.md` is regenerated to match. The `FieldSchema.useGrouping`
docblock in `src/data/field.zod.ts` said the interim rule looked at a field's `min` / `max`
bounds, and that the renderer half had not landed; both are corrected: the rule reads only a
declared `scale: 0` (ungrouped) against any other `scale` or none (grouped), and the renderer half
reads an authored value first. Text and ledger only: the schema, its `.describe()` string, every
export and all runtime behaviour are unchanged.
