// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27157 (ruling 6464202770 on #27119, Q2 = X). A tightened requirement: a
// fixed currency config needs its code, and the CNY the schema used to fill in
// is gone. The data-at-rest half is the D2 conversion
// `currency-config-dynamic-default-currency-removed`, retired from the load
// path from day one: stored rows and older built artifacts lose the code a
// dynamic config never read. A fixed config is never converted: one with a
// code keeps it, and a stored row saved without one stays as it is, loads
// with diagnostics, and is refused at its next save.
export const entry: SemanticMigration = {
  id: 'currency-config-fixed-default-currency-required',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    "field.currencyConfig (a currency field, or a formula field with returnType: 'currency') with "
    + "currencyMode: 'fixed' and no defaultCurrency, which parsed to defaultCurrency: 'CNY'",
  replacement:
    'Give a fixed config its currency: `currencyConfig: { currencyMode: \'fixed\', defaultCurrency: '
    + '\'USD\' }` (any three-character code; ISO 4217 for a real currency). Or, when the field should '
    + 'show amounts in the tenant default currency (the `localization.currency` setting), use '
    + '`currencyMode: \'dynamic\'`, or omit `currencyConfig`: dynamic is the default.',
  reason:
    'Maintainer ruling X, 2026-10-28: an amount whose currency is not known takes the tenant default, '
    + 'and nothing guesses. `defaultCurrency` was `.default(\'CNY\')`, so a fixed config written without '
    + 'a code became a yuan field and displayed ¥ in a dollar or euro app, and every dynamic config\'s '
    + 'parse output carried a CNY its readers had to know to ignore (a default the schema materialized '
    + 'on every parse). The default is removed: a fixed config without a code is refused at every door '
    + 'that parses a field, at the defaultCurrency path, with the prescription, and a dynamic config '
    + 'parses to output with no defaultCurrency unless one was written. OLDER BUILT ARTIFACTS hold the '
    + 'parsed stack, so a fixed config there carries the code the old parse filled in and keeps it. '
    + 'STORED sys_metadata OBJECT ROWS are kept as authored, so a row saved as { currencyMode: fixed } '
    + 'has no code, and nothing converts one in (a guessed CNY is what the ruling forbids). Such a row '
    + 'still loads and registers unchanged; boot counts it invalid with a [metadata_spec_invalid] line '
    + 'at fields.FIELD.currencyConfig.defaultCurrency, and its next save is refused with 422 '
    + 'INVALID_METADATA until the code is written. Its display does not change (the console reads a '
    + 'fixed code only when there is one, so it showed the tenant default before too); @objectstack/formula '
    + 'reads a formula over it as an unproven currency instead of fixed CNY. The D2 conversion '
    + '`currency-config-dynamic-default-currency-removed` strips the unread code from dynamic rows on '
    + 'rehydration and inside an artifact\'s declared-floor window, which changes no display. ADR-0087.',
  conversionIds: ['currency-config-dynamic-default-currency-removed'],
  acceptanceCriteria:
    'Search every authored object, object extension and field definition for a `currencyConfig` with '
    + '`currencyMode: \'fixed\'` and no `defaultCurrency`, and write the code the field is in (it '
    + 'displayed CNY until now), or switch it to dynamic. `FieldSchema.safeParse` answers one `custom` '
    + 'issue at `currencyConfig.defaultCurrency` for each such field. The repository carried no fixed '
    + 'config without a code at the time of the change (examples, platform objects, seeds and fixtures '
    + 'surveyed). For stored sys_metadata object rows, look for the `[metadata_spec_invalid]` boot line '
    + 'at `fields.FIELD.currencyConfig.defaultCurrency`: such a row displayed the tenant default, so '
    + 'switch it to dynamic or write the code it should carry, and save it.',
};
