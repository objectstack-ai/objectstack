---
'@objectstack/spec': minor
---

feat(spec)!: `CurrencyValueSchema` and its `CurrencyValue` type are removed from `@objectstack/spec/data` (ADR-0104 D1)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered currency-value-schema-retired -->

**BREAKING** for TypeScript code only: `import { CurrencyValueSchema } from '@objectstack/spec/data'` (or from `@objectstack/spec`), and `import type { CurrencyValue }`, no longer compile (TS2305). The schema declared a `{ value, currency }` object that nothing ever parsed or stored, and it contradicted the real contract: a `currency` field's value is a bare number in the record validator, the SQL driver, import coercion and the field-zoo oracle, and the currency code is field configuration. ADR-0104 had already decided the deletion; the export stayed `@deprecated` until now, and it goes before multi-currency work starts so that no author reads it as the shape that records a currency. No metadata document changes, and runtime behaviour is unchanged.

- `CurrencyValueSchema` / `CurrencyValue` (`{ value: 1000.5, currency: 'USD' }`) → none. Write and read the bare number (`1000.5`), and declare the code on the field: `currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' }`. To type or check a value, use `valueSchemaFor(field, 'stored')` from `@objectstack/spec/data`, which answers a number for a currency field.

The fix: delete the import and use `number` for the value. The upgrade guide entry is `currency-value-schema-retired`, and `data/CurrencyValue` is listed in `RETIRED_DEFS_BY_MAJOR[18]`.
