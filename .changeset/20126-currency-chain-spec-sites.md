---
'@objectstack/spec': patch
---

The currency-chain text shipped in `@objectstack/spec` states that `currencyConfig.defaultCurrency` is read only under `currencyMode: 'fixed'`, and no longer cites ADR-0053 (the date / datetime record) for currency (#20126)

Clause-②: no

A `dynamic` currency field (the default mode) has no currency of its own. Its amounts display in the tenant default currency (`localization.currency`), or as a plain number when none is set, and its `defaultCurrency`, including the parse default `CNY`, is not read. Each reader does this: the analytics relay (`AnalyticsServicePlugin`'s `sourceFieldMeta`), objectui's `resolveFieldCurrency`, and the spec's own precision refinement in `CurrencyConfigSchema`. Several published texts still described an unconditioned `defaultCurrency` step, or called the chain "ADR-0053":

- **`CurrencyConfigSchema.defaultCurrency` describe** (also regenerated into `content/docs/references/data/field.mdx`):
  - FROM: `Default or fixed currency code (ISO 4217, e.g., USD, CNY, EUR)`
  - TO: ``The currency code (ISO 4217, e.g. USD, CNY, EUR) of a `fixed`-mode field: its one currency. Not read under `dynamic` (the default), where amounts display in the tenant default currency.``
- **`AnalyticsResultResponseSchema` `data.fields[].currency` describe**:
  - FROM: ``Resolved ISO 4217 code for a MONETARY measure (explicit measure `currency`, then source-field default, then tenant default). Absent on non-monetary columns, which must never render a symbol.``
  - TO: ``Resolved ISO 4217 code for a MONETARY measure (explicit measure `currency`, then the source field's fixed currency — its `currencyConfig.defaultCurrency`, read only under `currencyMode: 'fixed'` — then the tenant default). Absent on non-monetary columns, which must never render a symbol.``
- **TSDoc**: `AnalyticsResult.fields[].currency` (`contracts`), the `AnalyticsResultResponseSchema` docblock and the percent-scale module header name the chain "the currency chain" and state its middle step as the field's fixed currency.
- **Liveness ledger** (`liveness/dataset.json` `currency`, `liveness/field.json` `currencyConfig`): the evidence is re-worded and re-anchored to the fixed-mode readers, and `verifiedAt` is re-dated. Both verdicts stay `live`.

⛔ No behaviour changes. No type, schema, accept set, default, authorable key or export moves. Only describe strings, TSDoc and ledger text change, and they ship: `dist` carries the describes and the emitted TSDoc, `src/**/*.zod.ts` carries the two edited schema files as source, and `liveness` carries both ledger files.
