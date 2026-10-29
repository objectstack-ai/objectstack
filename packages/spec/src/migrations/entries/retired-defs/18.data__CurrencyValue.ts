// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #27182 — `data/CurrencyValue` (`{value, currency}`), exported from
// `@objectstack/spec/data` as `CurrencyValueSchema` / `CurrencyValue`
// (`data/field.zod.ts`), leaves under ADR-0049 enforce-or-remove. ADR-0104 D1
// already decided it ("`currency` is a scalar number — `CurrencyValueSchema` is
// deleted"); it stayed on the published surface `@deprecated` with "Removal
// rides the next spec major", and the multi-currency epic (#8345, ruling
// 6465431966 on #27119) needs it gone first so no author reads it as the shape
// that records a currency. It was never consumed and contradicted the enforced
// contract: a `currency` field's value is a BARE NUMBER everywhere (validator,
// SQL driver `float` column, import coercion, field-zoo oracle), and the code
// lives in field config (`CurrencyConfigSchema`). Mounted by no stack key,
// registered as no metadata type, absent from every liveness ledger; on
// objectstack `fd73f2b3` every hit outside its own test, its type-alias pin and
// the generated baselines was prose. No carrier key, so no tombstone and no D2
// conversion: this table plus the D3 semantic entry
// `currency-value-schema-retired` ARE the declaration.
export const entry = 'data/CurrencyValue';
