---
'@objectstack/spec': minor
'@object-ui/i18n': minor
---

feat(spec): `currencyMode: 'record'` + `currencyField` — a record-mode amount points at a sibling ISO 4217 code field (ADR-0144 D2)

Clause-②: yes (widening)
Metadata-protocol: added

A currency amount (or a `formula` with `returnType: 'currency'`) can now carry a currency per record. `currencyConfig.currencyMode` gains a third value, `record`, and `currencyConfig.currencyField` names the field on the same object that holds each record's ISO 4217 code. The amount itself stays a bare number (ADR-0104 D1).

```ts
fields: {
  currency_code: Field.text({ label: 'Currency', valueDomain: 'iso_4217_currency' }),
  amount: Field.currency({ label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } }),
}
```

- `currencyField` is required under `record` and refused under `dynamic` and `fixed`.
- The object refuses a `currencyField` that names no other declared field, a field that is not `text`, or a `text` field without `valueDomain: 'iso_4217_currency'`. Each refusal is located at `fields.FIELD.currencyConfig.currencyField` and lists the object's candidate code fields.
- `dynamic` and `fixed` configs parse exactly as before; an app that never writes `record` sees no change.

⛔ Not released alone: this ships in the same release as the record-mode aggregate refusals and the per-row display.
