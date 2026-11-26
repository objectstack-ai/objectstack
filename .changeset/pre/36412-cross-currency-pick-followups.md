---
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/plugin-form': patch
---

fix(fields): a lookup pick that keeps an amount says so over a filled field too, a create form's opening fill no longer waits for ever on a parent it cannot read, and a pick that fills a currency code and an amount in it copies both

Clause-②: no
Metadata-protocol: none

Three follow-ups to the cross-currency pick rule (a pick copies an amount only into a field in the same currency). Nothing is converted, and no metadata changes.

- **A pick over a filled amount says why it kept it.** When a pick would replace an amount that already holds a value (a re-pick in a line-item grid, or a declared pair with `overwrite: true`) and the picked amount is in another currency, the earlier value stays and the note now shows there too, ending "Unit Price still holds its earlier value." Before, the note showed only over an empty field, so the earlier product's price sat under the new product with nothing said. The note goes away once somebody edits the field.
- **The opening fill of a create form no longer waits for ever.** A form opened with a lookup already holding a record (a related list's New, a URL prefill) fills its declared targets from it. When an amount there follows the currency of a parent the record names, the fill waited for that parent's read and never ran if the read failed, the data source cannot read single records (`findOne`), or the form names no parent object. Now the wait ends when the read answers, fails or cannot run: the other targets (a description) fill, and the amount is left empty with the note "the currency here could not be read".
- **A pick that fills a code field and its amount together copies both.** An amount that follows the record's own code field (`currencyMode: 'record'`) is now judged against the line or record with the same pick's write to that code field applied, in the line-item grid and in the record form. Picking a product that carries `currency_code: EUR` and a price in it onto a fresh line now fills the code and the price, where the price was withheld with a "no currency is chosen" note beside the code the same pick had just written.

Also in `@object-ui/fields`: new exports `declaredPickWrites`, `judgePickWrites`, `withheldStillStands` and the type `PickWrite`; `AmountCurrency` gains the kind `unread`, `WithheldAutofill` the reason `targetCurrencyUnread` and the optional `held` (the value a target kept); `amountCurrencyOf` takes an optional third argument, the pick's own writes; `AutofillCurrencyContext.targetCurrency` is handed them as an optional second argument. In `@object-ui/i18n`: two new `lookup.*` sentences, `autofillCurrencyUnread` and `autofillKept`, in every locale pack. In `@object-ui/plugin-form`: the record-form stamp's documentation lists the hosts the rule reaches; no behaviour changes there.
