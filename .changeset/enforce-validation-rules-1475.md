---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

Enforce every declared validation-rule type on the write path; trim the three that can't be (#1475).

The `validations` union advertised nine rule types but only three (`state_machine`,
`cross_field`, `script`) ran on insert/update — the other six were accepted by the
schema yet silently did nothing. This closes that gap on both sides: implement the
synchronous types, and trim the ones that don't belong in a write-path rule.

**`@objectstack/objectql` (additive):** the rule evaluator now enforces three more
types, all deterministic, synchronous, side-effect-free predicates over one record:

- `format` — a field value against a `regex` and/or a named format
  (`email` / `url` / `phone` / `json`). Runs only when the write touches the field
  and the value is non-empty; a malformed regex fails open.
- `json_schema` — a JSON field validated against a JSON Schema via `ajv` (compiled
  result memoised per schema). Accepts a parsed object or a JSON string; an
  unparseable string is itself a violation; an uncompilable schema fails open.
- `conditional` — evaluates `when`, then recurses into `then` / `otherwise`. The
  nested rule supplies the message; the outer conditional's `severity` decides
  blocking. `needsPriorRecord` now recurses into conditional branches.

Adds `ajv` as a dependency and three error codes (`invalid_format`, `invalid_json`,
`json_schema_violation`).

**`@objectstack/spec` (breaking for unused declarations):** removes the
`unique`, `async`, and `custom` validation-rule variants (and the
`UniquenessValidationSchema` / `AsyncValidationSchema` / `CustomValidatorSchema`
exports). They were never enforced and each needs I/O or a handler model a
write-path rule must not carry. Use the layer that already does each correctly:
uniqueness → a unique index (`ObjectSchema.indexes`, `partial` for scope) or
field-level `unique: true`; async/remote → the client form layer; custom code →
a `beforeInsert` / `beforeUpdate` lifecycle hook. Field-level `unique: true` is
unaffected.

`examples/app-showcase` demonstrates and verifies each newly-enforced type. See the
ADR-0020 addendum for the rationale.
