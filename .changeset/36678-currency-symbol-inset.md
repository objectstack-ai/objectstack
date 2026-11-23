---
'@object-ui/fields': patch
---

fix(fields): a currency field's symbol no longer covers the first digits of the amount

Clause-②: no
Metadata-protocol: none

The edit form's currency input reserved a fixed left inset sized for `$`, and the line-item grid's cell editor did the same. The symbol comes from `Intl` per currency and display locale, so wider symbols (`US$` and `HK$` under zh-CN, `CA$` and `CHF` under en-US) were drawn over the amount: `150000` read as `US$50000`. The input's inset now follows the symbol's rendered width; a `$`-wide symbol keeps exactly the inset it had.
