// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'home-amount-rate-field-scale-floor',
  surface:
    'object.fields.<amount>.currencyConfig.homeAmount.rateField on a record-currency amount: the number field it '
    + 'names declaring a scale below 12 (scale 0 to 11). A rate field with no scale, or a scale of 12 or more, is '
    + 'untouched',
  replacement:
    'Declare scale: 12 (or more) on the rate field, or delete its scale so the rate shows every digit it was '
    + 'stored with. Nothing else changes: the field stays a readonly number field and keeps its name',
  reason:
    'An exchange rate carries twelve decimal places (ruling 6469382727: scale 12, total precision 24). The engine '
    + 'stores the rate row\'s own value in the rate field, never rounded, and every numeric column is the same exact '
    + 'decimal, so a scale declared on the rate field constrains no write and reaches the display only: a rate field '
    + 'at scale 4 showed 0.1389 for a stored 0.138912345678, and the shown rate no longer reproduced the stored home '
    + 'amount (10000 / 0.138912345678 = 71987.84; at 0.1389 it is 71994.24). The object parse now refuses it at '
    + 'fields.AMOUNT.currencyConfig.homeAmount.rateField, naming the field, its scale and the floor 12. An undeclared '
    + 'scale is accepted: on a number field it declares no fixed width, so the rate shows its stored digits. NOT '
    + 'mechanically converted: raising the scale or deleting it are both right, and which one is the author\'s '
    + 'display choice. OLDER BUILT ARTIFACTS: an artifact whose object declares such a rate field fails its '
    + 'ObjectStackDefinitionSchema parse at load, before anything in it registers, so the whole artifact is refused '
    + 'and the metadata plugin\'s start fails with the Zod issue at that path; rebuild the artifact after fixing the '
    + 'source. STORED sys_metadata OBJECT ROWS are kept as authored and nothing converts one: such a row still loads '
    + 'and registers unchanged, boot logs it with a [metadata_spec_invalid] line at '
    + 'fields.AMOUNT.currencyConfig.homeAmount.rateField, and its next save is refused with 422 INVALID_METADATA '
    + 'until the scale is raised to 12 or more or deleted. Stored DATA rows (record values) are unaffected; the '
    + 'engine already kept every digit of the rate.',
  acceptanceCriteria:
    'objectstack validate (ObjectStackDefinitionSchema.safeParse) reports no issue at '
    + 'fields.AMOUNT.currencyConfig.homeAmount.rateField for any amount declaring homeAmount, and the rate field '
    + 'either declares no scale or declares scale 12 or more; a record written afterwards shows its stored rate with '
    + 'all of its decimals. Rebuild every built artifact after the fix. For stored sys_metadata object rows, look '
    + 'for the [metadata_spec_invalid] boot line at fields.AMOUNT.currencyConfig.homeAmount.rateField: raise that '
    + 'rate field\'s scale to 12 or more, or delete it, and save the object.',
};
