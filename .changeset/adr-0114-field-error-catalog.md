---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/objectql": minor
---

feat(spec,rest,objectql)!: a closed field-level error catalog, and Zod stops leaking onto the wire (#3977)

Settles the vocabulary ADR-0112 D6 deferred, per [ADR-0114](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0114-field-level-error-code-catalog.md).

**`FieldErrorCode` — a closed, lowercase catalog.** 27 members covering what the
six emitters already emit. `FieldErrorSchema.code` tightens from `z.string()` to
this enum, so a validation body's per-field codes are validated for the first time.
`FieldValidationError.code` (objectql) and `FieldCoerceError.code` (rest) stop
being a hand-listed union and a bare `string` respectively and reference the
catalog, so the three cannot drift apart.

Lowercase is deliberate, not an oversight against ADR-0112's SCREAMING_SNAKE: a
top-level code names the condition the *request* hit, while a field-level code
names the *constraint* the value violated — and constraints are declared in the
metadata's own snake_case, so `max_length` the code and `max_length: 50` the
property are the same word on purpose.

**Zod issue codes no longer reach the wire (wire-visible).** Routes that validate
with Zod passed its vocabulary straight through, so `fields[]` spoke a different
language depending on which route served it, and `too_small` was ambiguous between
a short string, a small number and a short array. `zodIssuesToFields` now maps
using Zod's `origin`/`format`:

| Was | Now |
|:---|:---|
| `too_small` | `min_length` / `min_value` / `min_items` |
| `too_big` | `max_length` / `max_value` / `max_items` |
| `invalid_format` | `invalid_email` / `invalid_url` / `invalid_format` |
| `invalid_value` | `invalid_option` |
| `unrecognized_keys` | `unknown_field` |
| `invalid_union`, `invalid_element`, `invalid_key` | `invalid_shape` |

**A missing required property now reports `required`, not `invalid_type`.** Zod
spells "absent" as a type mismatch against `undefined`, so passing it through made
a form mark a *missing* input as the wrong *type*. The two are indistinguishable on
the issue alone, so the mapper takes the parsed input as an optional argument and
walks the issue path; a caller that cannot supply it keeps `invalid_type` rather
than guessing.

**`unknown_param` → `unknown_field`.** `ActionParamIssue.code` references the
catalog instead of its own literal union; the `param` key beside it already says
what was addressed.

**Not changed:** `EnhancedApiErrorSchema.fieldErrors` keeps its name even though
every producer emits `fields`. Retiring an authorable key needs a tombstone plus a
migration (ADR-0104's contract guard), so it lands on its own — the property now
carries a banner saying which name the wire uses.
