---
'@objectstack/spec': minor
'@object-ui/fields': patch
---

feat(spec, fields): a roll-up of a stored home amount declares `currencyMode: 'dynamic'` and is drawn in the organization's home currency

Clause-②: yes (widening) — a `summary` with `function` `sum` / `min` / `max` / `avg` whose `summaryOperations.field` is a stored home amount (a child field some `homeAmount.field` on the child object names) is admitted with `currencyConfig: { currencyMode: 'dynamic' }` (or a config naming no `currencyMode`) and no `defaultCurrency`. Every summary refused before is still refused, except that one: a `dynamic` summary naming no child field or carrying a `defaultCurrency` is refused by the object, any other `dynamic` roll-up by `defineStack`, and a `count` in every mode as before.
Metadata-protocol: added
Skills-docs: follow-up #33714 — `skills/objectstack-data/rules/field-types.md` (its `homeAmount` paragraph teaches the stored home field but not that a `summary` over it declares `currencyMode: 'dynamic'`). `content/docs/data-modeling/currency.mdx` and `content/docs/data-modeling/field-types.mdx` are updated here.

ADR-0144 D6 has consolidated totals read the stored home field, and D8 rule 5 makes that field a `dynamic`-mode currency field shown in the organization's home currency (`localization.currency`). A `summary` over it totalled correctly but was drawn as a bare number (`250.00`), because no summary declaration was both admitted and honest: `record` is the follow-the-parent roll-up only, `dynamic` was refused on every summary, and `fixed` would name the home currency in metadata. A dashboard metric over the same home field already showed the symbol.

**Spec.** The roll-up of a home amount now declares `dynamic`, with no code:

```ts
actual_cost: {
  type: 'summary',
  summaryOperations: { object: 'expense', field: 'amount_home', function: 'sum', relationshipField: 'project' },
  currencyConfig: { currencyMode: 'dynamic' },
},
```

The object door (`refuseUnadmittedSummaryCurrency`) lets a `dynamic` summary through only when it names a child object and field and carries no `defaultCurrency`; its refusal messages now name this third admitted case beside `fixed` and `record`. `defineStack`'s cross-reference pass (`collectRecordCurrencyPathErrors`, new case (d)) admits it only when the child field is a stored home amount, and refuses any other `dynamic` roll-up with the declaration the child field does support: the record-mode amount's own home field, the child's home amounts, or its `fixed` code. A child the stack does not declare is not judged, as for a `record` roll-up.

**Console.** `summaryDeclaresCurrency` (`@object-ui/fields`) answers true for a `dynamic` summary, so the record page (`SummaryField`) and the list cell (`FormulaCellRenderer`) draw the total through `resolveFieldCurrency` in the tenant default currency: `$250.00` under a USD home currency, `CN¥1,800.00` under CNY, the same text a metric tile over the home field shows. With no home currency set it is a plain amount. A summary declaring no `currencyConfig` is unchanged.
