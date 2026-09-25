---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a dataset measure column takes the source field's currency only when that field's `currencyConfig.currencyMode` is `'fixed'`. Otherwise it takes the tenant default (#20091)

Clause-②: no

`AnalyticsServicePlugin` passes each source field's metadata to the service through `sourceFieldMeta`. That hook passed on `currencyConfig.defaultCurrency` whatever `currencyMode` said, and `queryDataset` put it on the result column as `currency`. The column is resolved in this order: the measure's own `currency`, then that value, then `ExecutionContext.currency`. So a `dynamic` field's `defaultCurrency` showed on analytics, chart and dataset faces, where the tenant currency belonged. That covers a `currencyConfig` naming no mode too, which is `dynamic` by the schema default. Parsed through the spec, a `currencyConfig: {}` also carries the schema's placeholder `CNY`, and that reached the column as if an author had written it.

- **What changes**: the relay now passes `defaultCurrency` on only under `currencyMode: 'fixed'`. This is the rule `CurrencyConfigSchema` declares, and objectui's field faces already follow it: only `fixed` gives a field one currency, and a field without one uses the tenant default at runtime. On both the live and the draft-preview path of `queryDataset`, the column now carries:
  - the field's currency for a `fixed` field;
  - `ExecutionContext.currency` for a `dynamic` field, a config naming no mode, an empty config, or no config at all.
- **What does not change**: a measure's explicit `currency` still wins, over a fixed field as well. A non-monetary measure still gets no code. `AnalyticsService.query` (the cube face) still carries no column currency. The `AnalyticsServiceConfig.sourceFieldMeta` type is unchanged.
- **Hosts that write their own `sourceFieldMeta`**: its `defaultCurrency` means the field's fixed currency. Return `currencyConfig.defaultCurrency` only when `currencyConfig.currencyMode === 'fixed'`, and return `undefined` otherwise. The TSDoc on `AnalyticsServiceConfig.sourceFieldMeta` states the rule.
