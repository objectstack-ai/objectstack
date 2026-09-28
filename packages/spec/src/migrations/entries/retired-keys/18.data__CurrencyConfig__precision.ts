// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19992 — ADR-0049 enforce-or-remove (triage direction REMOVE under ruling 乙
// on #19910: 「a currency's decimal places are the currency's, not a
// setting」). `currencyConfig.precision` was declared and validated against
// ISO 4217 (#7918) but read by NOTHING — measured with a positive control
// (`currencyConfig.currencyMode` IS read) over objectstack, objectui at the
// `.objectui-sha` pin and at `main`, and cloud `main`. objectui's
// `CurrencyField` derives decimal places from the currency's ISO 4217 minor
// unit and never read the key; its own contradiction check was its only
// reader. The `decimals` / `scale` aliases that pointed authors at it went
// with it (they now answer with the same prescription).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look. `CurrencyConfigSchema` is
// `strictObject`, so the route is strict deletion + a `guidance` entry carrying
// the prescription (no retiredKey tombstone — the key is out of the walked
// shape entirely). Sources and stored rows are rewritten by the D2 conversion
// `currency-config-precision-removed`, which strips the key from every field's
// `currencyConfig` on objects and object extensions — including the `2` the
// old `.overwrite()` baked into parse output.
export const entry = 'data/CurrencyConfig:precision';
