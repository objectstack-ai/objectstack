// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #19992 (ADR-0049 enforce-or-remove; triage direction REMOVE under ruling 乙
// on #19910: 「a currency's decimal places are the currency's, not a
// setting」) — the D3 entry of the `currency-config-precision-removed` family
// (ruling B on #17152: one D3 entry per retirement family, even when D2 is
// lossless). Registered key: `data/CurrencyConfig:precision`; the never-accepted
// `decimals` / `scale` spellings are answered by the same prescription and have
// no stored form to convert. The delete changes no rendered amount; what it
// leaves is a width belief, and code outside the platform that may have read the
// served key.
export const entry: SemanticMigration = {
  id: 'currency-config-precision-retired',
  surface: 'object.fields.*.currencyConfig.precision — the decimal-places key of a currency '
    + 'field\'s configuration, and its never-accepted `decimals` / `scale` spellings',
  replacement: '(removed — nothing replaces it.) A currency amount\'s decimal places are its '
    + 'currency\'s ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD), derived from the '
    + 'currency itself and declared nowhere. Delete the key. Do not move the number to the '
    + 'field-level `precision`: that key is the amount\'s total digit count, not its decimal '
    + 'places, and it is unchanged.',
  reason: 'The D2 conversion `currency-config-precision-removed` deletes the key from every '
    + 'field\'s `currencyConfig` on objects and object extensions — in author sources, in stored '
    + 'object rows and in built artifacts, which can carry a `2` the old schema wrote into parse '
    + 'output without anyone authoring it — and the delete is lossless: no renderer or runtime '
    + 'ever read the key. Every display face derives the width from the currency. Two judgments '
    + 'remain, and neither is a rewrite. First, a width that never applied: the old contradiction '
    + 'check judged an authored value only on a `fixed` field whose code has a known ISO 4217 '
    + 'minor unit, so on a `dynamic` field, and on a `fixed` field whose code has none (a crypto '
    + 'or custom code), an author could declare a width other than the one the field displays — '
    + 'and read amounts as if it applied. Whether the displayed width is acceptable for that '
    + 'field is the author\'s call. Second, code the chain cannot reach: a plugin, integration or '
    + 'export of your own that read `currencyConfig.precision` from served object metadata now '
    + 'finds no key, and must derive the width from the field\'s currency the way the platform\'s '
    + 'renderers always did.',
  acceptanceCriteria: 'No field\'s `currencyConfig` carries `precision`, `decimals` or `scale` — '
    + 'in sources, in stored object rows or in built artifacts; the parse refuses each by name '
    + 'with the prescription, and a stored row or artifact written before the upgrade loads '
    + 'without a refusal over it. No code of your own reads `currencyConfig.precision`; where it '
    + 'needed a width, it derives one from the field\'s currency. Every currency field renders '
    + 'its amounts exactly as before the upgrade, because the key never changed a rendered '
    + 'amount. `os migrate meta --stored --apply` rewrites stored rows so the per-row notice '
    + 'stops. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; '
    + '`--write` applies the ones it can prove, and you apply the rest by hand.',
};
