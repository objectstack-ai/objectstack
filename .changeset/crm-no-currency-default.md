---
"@objectstack/app-crm": patch
---

CRM example: remove hardcoded `defaultCurrency` from all currency fields. The
CRM example is a global reference implementation, so it should not bake in
any regional currency default (whether USD or CNY). Unconfigured currency
fields render as plain formatted numbers — real applications should set
`Field.currency({ currencyConfig: { defaultCurrency: ... } })` per business
context.
