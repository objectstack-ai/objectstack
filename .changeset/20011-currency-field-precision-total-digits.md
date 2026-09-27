---
"@objectstack/spec": minor
---

fix(spec): a currency field's `precision` is its total digit count again — `precision: 18` on a fixed-USD field parses instead of being refused as a contradiction of the currency's two decimal places (#20011)

Clause-②: yes (widening) — one refusal is removed from `FieldSchema`, so the accepted set grows. Nothing that parsed before is refused now, no key is renamed or retired, and the output of every previously accepted field is byte-identical.

## What was wrong

`FieldSchema` compared a currency field's field-level `precision` with the ISO 4217 fraction digits of its fixed currency, and refused any difference. The key is declared `Total digits (non-negative integer)`, so a DECIMAL(18,2) USD amount writes `precision: 18`. That field was refused with "currency USD has 2 fraction digits; `precision: 18` contradicts it", and the refusal told the author to write `precision: 2`, which is a total-digit count of 2.

The check assumed the field-level key was the currency display width, because the Studio currency widget used to read it that way. That reading is gone. The ruled contract is that a currency amount's decimal places come from the currency and are not a field setting. No renderer reads the field-level `precision` as decimal places, and the SQL column does not read it at all.

## What it does now

- The field-level `precision` on a `currency` field is not compared with the currency. Any non-negative integer parses in every currency mode and is carried through unchanged.
- `currencyConfig.precision` is a different key and is unchanged. Under `currencyMode: 'fixed'` it must still agree with the currency's fraction digits, and a contradiction is still refused at `currencyConfig.precision` with the same message.
- `scale` on a `currency` field is still refused.

Nothing to migrate. Metadata that parsed before parses the same way. A currency field that had to drop `precision` or set it to the currency's fraction digits to get through validation can now declare its real total digit count.
