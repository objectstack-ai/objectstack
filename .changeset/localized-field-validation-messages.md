---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/rest": minor
"@objectstack/runtime": patch
---

fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

The write path built every built-in validation message by concatenating the **API
field name** into a **hardcoded English** template. Those strings are what the
Console toast, the CSV-import row report, the CLI and any custom client display
verbatim, so a Chinese-locale user importing a bad row read:

```
第 1 行:penalty_amount must be ≥ 0
```

…for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
form layer localized the *same* constraint correctly (the browser's native
`min`), so the language flipped depending on which layer caught the value.

**Three things changed.**

1. **The message is rendered in the caller's locale** from a built-in catalog
   (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
   `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
   The locale comes from `ExecutionContext.locale`, whose contract already read
   "Drives message catalogs"; this is the consumer that makes that true. Both
   HTTP entries (REST server, runtime dispatcher) now resolve it from the
   request's `Accept-Language` / `?locale` first, falling back to the workspace
   `localization.locale` — so a rejection message and the field labels around it
   can no longer disagree.

2. **The field is named by its label, never the API name**: translation bundle
   (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
   resort. `FieldValidationError.field` still carries the API name so a form can
   focus the right input.

3. **The constraint is exposed as data**, so a client can format its own text
   instead of parsing the sentence:
   `{ field, code, message, label, constraint: { min: 0 } }`. This rides
   ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
   (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
   than adding a parallel payload — `label` is the only new field. The bag
   carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
   message templates interpolate from exactly those keys.

Covered end-to-end, not only in the validator: single and batch insert,
single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
state-machine fallbacks), and the importer's cell-coercion, required pre-check
and #3956 bound pre-check messages — all of which land in the same row report.

**What this changes for consumers.**

- `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
  match on. Message keys are finer-grained than codes — `invalid_datetime`,
  `invalid_option_value`, `required_cleared` are rendering detail and never reach
  the wire — so localization never splits the client-facing vocabulary.
- `message` **text changes**: it is localized, and it names the field by label
  even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
  asserting on the old English string should match `code` (and now
  `constraint`) instead.
- An author-written validation-rule `message` is never touched — it is already
  in the language its author chose.
- A deployment can override any built-in message with a `translation` item
  defining `validation.field.<messageKey>` (e.g.
  `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
- The importer's reference-failure message no longer names the target object's
  API name (`no sys_user matches "…"`): naming internal identifiers is the
  defect being fixed, and the column plus the offending value are what an
  importer can act on.
