// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'inline-grid-column-currency-scale-refused',
  surface: 'object.fields.<name>.inlineColumns[].scale on an inline grid column that declares '
    + '`type: \'currency\'` — any declared value, `scale: 0` included, computed or not. `scale` on a '
    + '`number` column is untouched. A column that declares no `type` is judged as the type it '
    + 'renders as: over a `currency` field of the child object it is entry '
    + '`inline-grid-column-identity-only-currency-scale-refused`',
  replacement: 'no `scale` on a currency inline grid column. DELETE the key — that is the whole '
    + 'migration: a currency amount\'s decimal places are its currency\'s, not a column setting. The '
    + 'currency\'s ISO 4217 minor unit decides how the cell displays the amount and the width a '
    + 'computed amount is rounded to. ⛔ Nothing replaces the key: do not re-declare its value under '
    + 'any other key.',
  reason:
    'The maintainer\'s ruling of 2026-09-23 (option B) retired `scale` from the `currency` field '
    + 'type, and the ruling of 2026-09-24 (option 乙 — a currency\'s ISO 4217 minor unit decides its '
    + 'display) worded the remedy. Neither reached the inline grid '
    + 'column, the strict mirror of the console grid\'s column, which still offered per-column '
    + 'decimals on a `currency` column; triage read the column as inherited from both rulings, so '
    + '`InlineGridColumnSchema` now refuses the key on a column declaring `type: \'currency\'` at '
    + 'parse, with the field refusal\'s first sentence and remedy. ⛔ No alias and no grace window, '
    + 'per ruling B. NOT mechanically converted, deliberately, for the reason the field entry '
    + '`field-currency-scale-refused` gives: a conversion that dropped the key would accept it on '
    + 'every load, which is the grace window the ruling refused; the refusal names the key and its '
    + 'one-line fix instead. The same change rewords the column\'s `prefix` description: it replaces '
    + 'the resolved currency\'s symbol and has no default (the grid no longer falls back to a fixed '
    + 'yen sign). Reach: the column schema judges only a DECLARED column `type` — a column that '
    + 'declares none takes its type from the child field when the console hydrates it, which the '
    + 'schema cannot see; `defineStack` judges that column instead (entry '
    + '`inline-grid-column-identity-only-currency-scale-refused`). Population measured at the '
    + 'change, on origin/main 1c8b320a89: one authored `inlineColumns` block in the tree (the '
    + 'showcase invoice, seven identity-only columns, none declaring `type` or `scale`), no platform '
    + 'object, skill, documentation example or JSON fixture declaring an inline grid column at all, '
    + 'and one test fixture carrying `scale: 2` on a currency column, re-judged in the same change. '
    + 'Deployed metadata NOT MEASURED.',
  acceptanceCriteria:
    'Every field in the stack parses: an `ObjectSchema` parse and `objectstack validate` report no '
    + 'issue on an `inlineColumns[].scale` path of a column declaring `type: \'currency\'`. A '
    + 'currency column that carried `scale` no longer declares it, and a diff of the column shows '
    + 'that one line deleted and no key added. `number` columns keep their `scale`, and so does a '
    + 'column declaring no `type` unless it names a `currency` field of the child object (entry '
    + '`inline-grid-column-identity-only-currency-scale-refused`); a column\'s `prefix` is still '
    + 'accepted on a currency column.',
};
