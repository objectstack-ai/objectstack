---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/mcp': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
'@objectstack/scenarios': minor
'@object-ui/app-shell': minor
---

fix(formula)!: `validateExpression` refuses `==` / `!=` between a list-valued field and a scalar, which answers a constant on every row

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-formula/SKILL.md

<!-- adr-0087: registered cel-list-equality-refused -->

**BREAKING** accept-set narrowing, shipped as `minor`. CEL compares the whole list with the scalar, so `record.labels == 'frontend'` is `false` for `['frontend', 'qa']` and for `null` alike, and `record.labels != 'frontend'` is always `true`: a condition written that way never fires (or always does), with no fault and no log line. The shared validator accepted it.

- **The refusal.** `validateExpression` refuses a `==` / `!=` between a read of a list-valued field on `record` / `previous` (`record.f`, `record['f']`, either operand order) — or, at a flattened (flow) condition, its bare name `f`, which the run binds to the trigger record's field, unless a flow variable holds the name or a node can bind names no reader sees — and a non-null string, number or boolean literal, as the new `list-equality` code (params `reference`, `operator`, `operand`, `answer`, `rewrite`), prescribing the null-guarded membership test.
- **Which fields are lists.** A `fieldTypes` entry of an inherently multi-value type (`multiselect`, `checkboxes`, `tags`), or a field named in the new optional `ExprSchemaHint.multiValueFields` — the fields a caller reads as multi-valued through `isMultiValueField` (`@objectstack/spec/data`), which is how a `select` / `radio` / `lookup` / `user` / `file` / `image` field declared `multiple: true` becomes a list here. Absent, such a field is not judged, as before.
- **Who fills it.** The publish lint (`os validate` / `os build`, every CEL site that types the object's fields), the MCP `validate_expression` tool (read off the served definition, `McpDataBridge.servedObjectDefinitionOf`, at the validation / formula / flow-condition sites; a bridge without it answers as before), `registerFlow`'s schema pass (`parseObjectFieldSchema` returns `multiValueFields`; logged, never thrown, like every finding of that pass), the scenario scorer, and Studio's object draft check (field rules, formulas, validation rules; `CelSchemaHint.multiValueFields`).
- **Still accepted.** `S == null` / `S != null` (either side), `'a' in S`, a list compared with a list literal or with another list field, and a comparison whose other operand is not a literal.

FROM → TO:

- `record.labels == 'frontend'` → `record.labels != null && 'frontend' in record.labels`
- `record.labels != 'frontend'` → `record.labels == null || !('frontend' in record.labels)`
- at a flow condition, `labels == 'frontend'` → `labels != null && 'frontend' in labels`

One-line fix: test membership with `in`, null-guarded (`'a' in null` faults); compare the list with `null` to test whether it is set.
