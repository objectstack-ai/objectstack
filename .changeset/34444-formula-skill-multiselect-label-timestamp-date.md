---
'@objectstack/skills': patch
---

docs(skills): `objectstack-formula` teaches `label()` over a multi-select and the `timestamp()` refusal over a date field

Clause-②: no
Metadata-protocol: none

The `label(record.f)` row of the `objectstack-formula` built-ins table now says what a select with `multiple: true` reads: each selected value's option label in the reader's locale, in the order the record stores them, joined with `, `; an empty selection reads `''`, as null does.

The built-ins line that lists `timestamp(s)` now says that `timestamp()` parses only a full ISO instant, so over a `date` field (its `YYYY-MM-DD` text) the build refuses it as `date-text-call`, inside `+ duration(…)` arithmetic too, and that a date is shifted with `isoDate(addDays(record.d, n))`. Both are the behaviour `@objectstack/formula` already ships; the skill only teaches it. One eval case covers each.

Paid down first under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068): three restatements were cut, each keeping another home — the `has()` paragraph's null-check sentence (the cheat-sheet `Null check` row), the template section's `shared/expression.zod.ts` sentence (Core contract and See also), and the translation-table note's per-matched-row clause (the §5 `previous` table). The token ceiling moves by the measured remainder, +11 (5997 → 6008).
