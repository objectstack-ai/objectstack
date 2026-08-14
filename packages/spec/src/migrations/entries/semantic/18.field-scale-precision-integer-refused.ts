// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-scale-precision-integer-refused',
  surface: 'object field `scale` / `precision` declarations (`Field.number` and friends) — '
    + 'non-integer or negative values (`scale: 2.5`, `precision: -1`)',
  replacement: 'a non-negative integer digit count, or no declaration at all. The mechanical '
    + 'conversion (`field-malformed-scale-precision-removed`) deletes a malformed value — '
    + 'behaviour-preserving, because #7501\'s enforcement deliberately skipped malformed '
    + 'declarations, so they enforced nothing — but only the author knows the count they '
    + 'MEANT (`scale: 2.5` was probably `2` or `3`): re-declare it deliberately if the '
    + 'constraint was wanted',
  reason:
    'Both keys are digit COUNTS ("Total digits" / "Decimal places"), and `z.number()` admitted '
    + 'values with no defined meaning as a count. That looseness became load-bearing when #7501 '
    + 'made `scale` enforced at write time: the runtime branch deliberately guards on '
    + '`Number.isInteger(def.scale) && def.scale >= 0` — inventing floor/round semantics in a '
    + 'consumer would be PD #12 guessing — so a typo\'d declaration (`scale: 2.5`) silently got '
    + 'no enforcement at all: exactly the declared-but-inert shape that hides AI-authored '
    + 'metadata errors. The schema now refuses non-integer and negative values for both keys at '
    + 'parse time (`z.number().int().min(0)`, ADR-0078 declared=enforced). '
    + '`CurrencyConfigSchema.precision` (under `currencyConfig`) is a different surface with its '
    + 'own bounds and alias table and is unchanged.',
  acceptanceCriteria:
    'Every field declaring `scale` or `precision` carries a non-negative integer. Well-formed '
    + 'declarations (`0`, `2`, any non-negative integer) parse byte-identically to before; '
    + 'fields declaring neither key are untouched. Stored `sys_metadata` rows carrying a '
    + 'malformed value keep loading (the rehydration seam replays the conversion, which drops '
    + 'the meaningless key).',
};
