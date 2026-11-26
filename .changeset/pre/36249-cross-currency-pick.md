---
'@objectstack/spec': minor
'@object-ui/fields': minor
'@object-ui/i18n': minor
'@object-ui/plugin-form': minor
---

fix(fields): a lookup pick no longer copies an amount into a field in another currency; the field stays empty and the form says why

Clause-②: yes (narrowing) — a cross-currency price copy that happens today stops and the line is left empty with a stated reason (ruled B); widened: three new `@object-ui/i18n` `lookup.autofill*` keys in every locale pack, new `@object-ui/fields` exports from `lookupAutofill.ts` (`planDeclaredLookupAutofill`, `crossCurrencyRefusal`, `amountCurrencyOf`, `pickedAmountCurrencyOf`, `withheldAutofillMessage`, `withLookupAutofillTargets`, `readLookupAutofillTargets`, `LOOKUP_AUTOFILL_TARGETS_KEY` and their types), an optional second argument on `onSelectRecord`, an optional trailing `currency` parameter on `declaredLookupAutofillPatch` and `lookupAutofillPatch`, and the optional `columnFields` prop on `GridField`
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is what a pick copies in the browser. The fix for an author is in the body: the price on a line in another currency is entered by hand. -->

**BREAKING** for forms and line-item grids that relied on a pick copying an amount across currencies. On a EUR invoice, picking a product whose price is in the home currency used to copy the number as euros (a $100 product became a €100 line). Nothing converted it. Now the price is not copied: the cell or field stays empty, and a note under the line (in a grid) or under the lookup (in a form) names the picked amount with its currency and the currency of the field, so the price can be entered by hand. The other fields of the same pick (a description) still fill.

**The rule.** It applies to the grid's same-named copy (the column key `autofill`), to the grid's declared `lookupAutofill` pairs, and to the record form's declared pairs, on a pick and on a create form's opening fill:

- an amount is a `currency` field or a `formula` returning `currency`; a `number` carries no currency and copies as before;
- both sides in the home currency (neither declares one) copy as before, also when no home currency is configured;
- otherwise the value copies only when both sides name the same known code: a `fixed` code, the code the record holds, or the code its `master_detail` parent holds (ADR-0144 D2 as amended), with the home currency counting as its configured code;
- a field that follows a record's currency while that record holds none yet is not filled, and the note says no currency is chosen yet.

Nothing is converted at any rate, and no build-time check is added: the line's currency is known only while the form is open.

**`@objectstack/spec`.** The describes of `FieldSchema.lookupAutofill` and of the inline grid column key `autofill` state the rule.

**`@object-ui/fields`.** `planDeclaredLookupAutofill` returns the writes and the withheld values of a pick; `declaredLookupAutofillPatch` and `lookupAutofillPatch` keep returning the writes alone. `LookupField` hands a host that owns the pick (`onSelectRecord`) the referenced object's field map as a second argument. `GridField` takes `columnFields`, the child field behind each currency column, so a `fixed` code or a code on the line decides that column's currency as on the record form.

**`@object-ui/plugin-form`.** The record form stamps the definitions of a lookup's `lookupAutofill` targets on the lookup's field metadata, each with the name the form shows for it, so the lookup can read each target's currency and names it as the form does. The line-item hosts hand their grid each currency column's child field.

**`@object-ui/i18n`.** Three new `lookup.autofill*` sentences, in every locale pack.
