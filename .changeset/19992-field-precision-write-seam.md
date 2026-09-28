---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

feat(objectql,spec)!: a numeric field's declared `precision` ("Total digits") is enforced on writes — a value that needs more digits is refused with field code `max_precision` (#19992)

Clause-②: yes

**BREAKING** — a narrowing of the write accept set on `@objectstack/objectql`, shipped as `minor` under the repo's launch-window convention (`check-changeset-no-major` refuses `major` until GA); the breaking-ness is carried by this banner and the ADR-0087 disposition, never by the level. Nothing an author writes changes spelling: `precision` keeps its key, its type and its legality.

`FieldSchema.precision` was declared ("Total digits") and read by nothing. Every numeric column is the fixed exact decimal of `NUMERIC_COLUMN_REPRESENTATION`, the record validator had no branch for it, and the renderer reads the liveness ledger cited are gone, so `precision: 5` on a `number` stored `123456789` verbatim. The metadata designer writes the key (labelled Precision, beside Scale), so it was a setting an author could make and see nothing come of. It is now enforced at the one place a write is judged.

**`@objectstack/objectql`** — the record validator refuses, after `min` / `max` and `max_scale`, a `number`, `currency`, `percent`, `rating` or `slider` value whose digit count exceeds a declared `precision`. It refuses with `400 VALIDATION_FAILED` and the field code `max_precision`, and it never rounds. The count is the SQL `DECIMAL(p, s)` one, taken on the stored value:

- **With a `scale`**, digits are counted at the field's decimal places, so the integer part may carry `precision − scale` digits. `precision: 5, scale: 2` holds up to `999.99` and refuses `1234.5`, which is `1234.50`, six digits.
- **With no `scale`**, the value's own digits count. Leading zeros never count, and trailing zeros of the integer part always do: under `precision: 4`, `0.001` fits and `10000` does not.
- **On `currency`**, where `scale` is refused, an amount counts at its own decimals. The decimals themselves stay unconstrained, and only the total is bounded: `precision: 18` refuses a 19-digit amount.
- **On a fraction-stored `percent`** the count is taken two places further right (`scale + 2`, or 2 with no `scale`). The count is then the percentage-point value's digits as displayed: `precision: 4, scale: 2` holds 99.99% and refuses 100%.

What an author with an oversize value sees: the write is refused, nothing is stored, and the field error names the declaration and the count. For example, `constraint: { precision: 5, scale: 2, actual: 6 }` renders as "Hourly rate must have at most 5 digits in total, counting 2 decimal places (got 6)" in four locales. The REST create, batch, update and import routes all answer it, and `validate` (the dry run) predicts it. Only NEW writes are judged: a stored value longer than a `precision` declared later is never re-read. Nothing changes in storage or DDL.

The fix is one of three. Write a value that fits. Raise `precision` to the digits the field really holds. Or delete the key if the number was meant as decimal places: those are `scale`, and a currency's decimal places are its ISO 4217 minor unit.

**`@objectstack/spec`** — `FieldErrorCode` (the ADR-0114 field-level catalog) gains `max_precision` beside `max_scale`. `BUILTIN_VALIDATION_MESSAGES` gains its two sentences, `max_precision` and `max_precision_scaled`, in `en` / `zh-CN` / `ja-JP` / `es-ES`. `FieldSchema.precision`'s describe now states the counting rule and where it is enforced. The `precision` row of the field liveness ledger is re-evidenced at the write seam.

**Who is affected, measured** on `origin/main` `df3ba164`: no example app, template, platform object, seed or JSON fixture in the tree declares a field-level `precision`. Two test fixtures do (`precision: 5, scale: 0` on a 1–12 hours field), and every value they write fits.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `precision` keeps its key, its type (`z.number().int().min(0)`) and its legality on every field type, and no stored metadata representation changes, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What narrows is the record validator's write accept set for values under an already-declared count, which is runtime behaviour, not an authored shape. The spec edits add a member to a closed enum, two message templates and a describe; none removes or renames anything an author can write. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id is minted here and none covers this (not `registered` / `already-registered`); and runtime behaviour changes, not only a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
