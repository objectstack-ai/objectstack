---
'@objectstack/spec': minor
'@objectstack/skills': minor
---

feat(spec): `currencyConfig.homeAmount: { field, rateDate, rateField }` — a record-mode amount declares its stored home-currency amount by pointer (ADR-0144 D5)

Clause-②: yes (widening)
Metadata-protocol: added

⛔ Not released alone: this ships in the same release as the write-time home-currency projection that fills these fields (ADR-0144 D9, release R2: "the `homeAmount` key never ships ahead of the engine").

An amount in `currencyMode: 'record'` can now declare where its value is stored after conversion into the organization's home currency (the `localization.currency` setting), which date picks the exchange rate, and where the rate used is stored. Consolidated totals then aggregate the home field like any other stored currency field.

```ts
fields: {
  currency_code: Field.text({ label: 'Currency', valueDomain: 'iso_4217_currency' }),
  invoice_date: Field.date({ label: 'Invoice date' }),
  amount: Field.currency({
    label: 'Amount',
    currencyConfig: {
      currencyMode: 'record',
      currencyField: 'currency_code',
      homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
    },
  }),
  amount_home: Field.currency({ label: 'Amount (home)', readonly: true }),
  amount_rate: Field.number({ label: 'Rate used', readonly: true }),
}
```

- **Three required pointers.** When `homeAmount` is declared, `field`, `rateDate` and `rateField` must all be given, and none may be empty. There is no default, no injected column and no fixed field name. The document date is never taken from `created_at`. `homeAmount` is refused under `dynamic` and `fixed`.
- **What the pointers name, refused at parse with a remedy and the object's candidates.** Each refusal is located at `fields.AMOUNT.currencyConfig.homeAmount.POINTER`.
  - `field` must name another `currency` field of the same object in `dynamic` mode (it displays in the home currency, so metadata never names that currency). No other amount may already store into it.
  - `rateDate` must name a `date` or `datetime` field.
  - `rateField` must name a `number` field. Two amounts may share it only when they have the same `currencyField` and `rateDate`.
  - The amount itself must be a stored `currency` field. A `formula` amount is refused.
- **The home and rate fields are written by the platform only.** They must declare `readonly: true`, the existing mark that drops a client's write of the field, and no `expression`.
- **Skills:** `objectstack-data/rules/field-types.md` teaches `homeAmount`. Its field names (`amount_home`, `amount_rate`) are examples, not a contract.
- **Nothing to migrate.** `homeAmount` is new, and no existing config changes meaning.
