---
"@objectstack/spec": minor
---

feat(spec): declare the `$empty` filter operator — what 「is empty」 means, once, per field type — staged ahead of its executors (#20311)

Clause-②: yes (widening) — a declared operator slot and five exports are added. `FieldOperatorsSchema.parse({ $empty: true })` used to strip the undeclared key and now keeps it. The one refusal that comes with the declared type sits on a key nothing writes (see below).

**⚠️ Authoring `$empty` today is refused at query time.** The operator is declared but STAGED: it is deliberately absent from `FILTER_OPERATORS`, so no query executor answers it yet. A hand-written `{ "f": { "$empty": true } }` gets `INVALID_FILTER` / 400 from `driver-sql` (and the drivers that inherit its compiler), `driver-turso`'s remote transport, `driver-memory`, `driver-mongodb`, objectql `having` and the analytics `where` compiler; `READ_SCOPE_COMPILE_FAILED` / 500 (fail-closed) from the analytics read-scope SQL compiler; and `@objectstack/formula`'s write-side `matchesFilterCondition` answers `false` for every record, its fail-closed posture for an operator it has no arm for. Until each of those faces has its arm, write 「is empty」 with the view operator `is_empty`, which is unchanged.

**What the operator means.** Its description is the ruled per-type table (ruling B on #20311, spelled as an operator by ruling A on #20399):

| field type | `$empty: true` matches |
|---|---|
| text-like (`STRING_VALUE_TYPES`: text, textarea, email, url, phone, password, secret, markdown, html, richtext, code, color, signature, qrcode) | null or `''` |
| multi-value (`isMultiValueField`: multiselect, checkboxes, tags, and select, radio, lookup, user, file or image with `multiple: true`) | null or `[]` |
| every other type | null only |

`$empty: false` is the exact complement. A face that holds no field declaration (the formula matcher, objectql `having`) judges by the value: null, `''` and `[]` are empty.

**The one expansion every face calls**, exported from `@objectstack/spec/data`:

- `expandEmptyOperator(field)` — keyed on the field DEFINITION (type plus `multiple`), because a `lookup` is `null_only` and a `lookup` with `multiple: true` is `multi_value`. Returns one of the frozen `EMPTY_OPERATOR_ARMS` rows: `{ arm, emptyString, emptyList }` (`EmptyOperatorArm`, `EmptyOperatorExpansion`).
- `isEmptyFilterValue(value, expansion?)` — the value-level half: with an expansion, the declared row; without one, the by-value reading for the declaration-free faces.

**What does not change.**

- The `is_empty` / `is_not_empty` view operators still lower to `{ "$null": true | false }`. A later change flips that lowering to `$empty` once every face answers it; no stored filter changes result in this release.
- An empty list is still refused as an equality comparand: `{ "tags": [] }` and `{ "tags": { "$eq": [] } }` keep their refusal. The multi-value row lives in the operator precisely because it cannot be spelled as a lowered equality.
- `FILTER_OPERATORS` is unchanged, so every executor that derives its accepted set from it (`driver-memory`'s gate among them) keeps refusing `$empty` rather than dropping it.

**One new refusal, on a key nothing writes.** A NON-boolean `$empty` (`"true"`, `1`, `null`) is refused where the declared boolean flags `$null` / `$exists` already are: at the operator slot, and at the save door (`FilterConditionSchema` and the analytics filter carriers that share its slot check), in the flags' own first sentence. `$empty` appears nowhere in this repository or in objectui's `main` before this change (0 occurrences in either).

**Stored sharing rules** (ruling B's landing measurement): the criteria sharing rules in this repository's examples and objectui's fixtures that use 「is empty」 are 0, and this release changes no lowering, so none changes result. Production sharing rules are NOT MEASURED: they are unreadable from here.
