---
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

fix(fields): after a currency change in the same edit, a lookup pick's amounts stay as they are and the notes beside them follow the new currency

Clause-②: yes (widening)
Metadata-protocol: none

Follows the cross-currency pick rule (a pick copies an amount only into a field in the same currency). Changing the record's currency in the same edit (a new record, one with no saved lines, lines staged in this edit) still changes and clears no amount. Now the notes say what that means, in the line-item grid and in the record form. Nothing is converted, and no metadata changes.

- **An amount a pick copied gets a note once the currency changes.** If a pick copied a price while the record was in one currency and the record is now in another, a note under the field says so: "Unit Price was copied as $100.00, but the record is now in EUR. Enter Unit Price in EUR if it should change." The note goes away when the currency changes back or someone edits the amount. An amount typed by hand gets no note.
- **A note about a price that was not copied follows the new currency.** The "was not filled" note is judged again against the record's currency as it is now, so it names the new currency, not the one at the pick.
- **When the record changes to the picked price's own currency, the note stays and the field stays empty.** It now says "Unit Price was not filled when it was picked. The record is now in USD: pick again to fill $100.00." A currency change never fills a field by itself. If the field still holds an earlier value (a pick over a filled field), the note says to clear it first, because picking the same record again does not replace a value that record did not fill: "Unit Price was not filled when it was picked and still holds its earlier value. The record is now in USD: clear Unit Price, then pick again to fill $100.00."

Also in `@object-ui/fields`, a widening of its published surface, with nothing removed or made required: new exports `withheldAutofillNow`, `copiedAutofillNow`, `copiedAutofillMessage` and the type `CopiedAutofill`. `LookupAutofillPlan` gains the optional `copied`, the amounts a pick wrote and the currency each was written in; it is absent when there are none, so a plan built without it is still a valid plan. The `WithheldAutofill.reason` union widens with `nowSameCurrency`: code that switches over every reason gains one case to say. In `@object-ui/i18n`: three new `lookup.*` sentences, `autofillNowSameCurrency`, `autofillNowSameCurrencyHeld` and `autofillCopiedUnder`, in every locale pack.
