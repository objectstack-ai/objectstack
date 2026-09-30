// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20901 — the reach of `inline-grid-column-currency-scale-refused`, extended to
// the column that declares no `type`. The column schema judges only a DECLARED
// type; an identity-only column takes its type from the child field when the
// console hydrates it, and the child field is a fact the stack holds. So
// `defineStack`'s cross-reference check re-parses such a column as the type it
// renders as and reports the column schema's own refusal — no second scale
// rule. D3 only, for the reason the declared-type entry gives: a conversion
// that dropped the key would accept it on every load, the grace window the
// ruling refused.
export const entry: SemanticMigration = {
  id: 'inline-grid-column-identity-only-currency-scale-refused',
  surface: 'object.fields.<name>.inlineColumns[].scale and view.form.subforms[].columns[].scale '
    + '(and each formViews entry) on a column that declares NO `type` and whose `name` is a '
    + '`currency` field of the child object — any value, `scale: 0` included. A column declaring '
    + '`type: \'number\'`, and a column over a field of any other type, keep `scale`',
  replacement: 'no `scale` on the column. DELETE the key — that is the whole migration: the column '
    + 'renders as a currency column, and a currency amount\'s decimal places are its currency\'s. '
    + 'The currency\'s ISO 4217 minor unit decides how the cell displays the amount and the width a '
    + 'computed amount is rounded to. ⛔ Nothing replaces the key: do not re-declare its value under '
    + 'any other key, and do not add `type: \'number\'` to keep it on a currency amount.',
  reason: 'The refusal of `scale` on a currency inline grid column (entry '
    + '`inline-grid-column-currency-scale-refused`, under the maintainer\'s rulings of 2026-09-23, '
    + 'option B, and 2026-09-24, option 乙) reached only a column that DECLARES `type: \'currency\'`, '
    + 'because the column schema cannot see the child field. An identity-only column — the '
    + 'recommended form — over a currency field renders as a currency column all the same, so it '
    + 'published green carrying the refused key, and the console ignored it. `defineStack`\'s '
    + 'cross-reference check, which holds the child object\'s fields, now judges such a column as the '
    + 'type it renders as and refuses it with the column schema\'s own message. Reach: the child '
    + 'object must be declared in the same stack; a column naming no field of it, or a subform whose '
    + 'child object comes from another package, is not judged there. Population measured at the '
    + 'change, on origin/main cb4c31dd52: one authored `inlineColumns` block (the showcase invoice, '
    + 'seven identity-only columns, none carrying `scale`) and zero authored `subforms`. Deployed '
    + 'metadata NOT MEASURED.',
  acceptanceCriteria: '`objectstack validate` and `defineStack` report no cross-reference finding on '
    + 'an `inlineColumns[].scale` or `subforms[].columns[].scale` path. A column that carried `scale` '
    + 'over a currency child field no longer declares it, and a diff of the column shows that one line '
    + 'deleted and no key added. Columns over `number` fields, and columns declaring `type: '
    + '\'number\'`, keep their `scale`.',
};
