// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'currency-value-schema-retired',
  surface:
    'data.currencyValue (the whole of CurrencyValueSchema in data/field.zod.ts — 1 def, '
    + 'data/CurrencyValue, and 2 exported names: CurrencyValueSchema and CurrencyValue)',
  replacement:
    'a `currency` field\'s value is a BARE NUMBER — `{ value: 1000.5, currency: \'USD\' }` '
    + 'becomes `1000.5`. The currency code is field configuration, not part of the value: '
    + 'declare it as `currencyConfig: { currencyMode: \'fixed\', defaultCurrency: \'USD\' }` '
    + '(CurrencyConfigSchema). To type or check a value, use `valueSchemaFor(field, \'stored\')` '
    + 'from `@objectstack/spec/data` (the ADR-0104 D1 value contract), which answers `number` '
    + 'for a currency field',
  reason:
    'ADR-0049 enforce-or-remove; ADR-0104 D1 ("Reality wins": `currency` is a scalar number '
    + 'and CurrencyValueSchema is deleted), carried out as the prerequisite of the multi-currency '
    + 'epic so no author reads the dead shape as the way a record keeps its currency. The schema '
    + 'declared `{value, currency}` and was never consumed: the record validator, the SQL '
    + 'driver\'s `float` column, import coercion and the field-zoo oracle all store and check a '
    + 'bare number, and the value contract REJECTS the object shape. It was `@deprecated` since '
    + 'ADR-0104 and stayed exported only because removal waited for a release. No carrier key and '
    + 'no metadata type ever held it, so there is nothing to tombstone and no seam for a D2 '
    + 'conversion: RETIRED_DEFS_BY_MAJOR plus this entry ARE the declaration. `cloud` and real '
    + 'customer code are UNMEASURED.',
  acceptanceCriteria:
    'No code imports CurrencyValueSchema or CurrencyValue from @objectstack/spec or '
    + '@objectstack/spec/data — every such import is TS2305 after upgrade (pinned in '
    + '`data/currency-value-retirement.test.ts`). Code that built or read `{value, currency}` '
    + 'objects for a currency field writes and reads the bare number instead, and takes the code '
    + 'from the field\'s `currencyConfig.defaultCurrency`. CurrencyConfigSchema is unchanged. '
    + '`data/CurrencyValue` is absent from `json-schema.manifest/data.json`, the api-surface / '
    + 'declaration-map / export-origins shards and the generated reference docs. ⚠️ Runtime '
    + 'behaviour is deliberately UNCHANGED: nothing ever parsed with the schema, so removing it '
    + 'removes no behaviour — currency values were bare numbers before and after.',
};
