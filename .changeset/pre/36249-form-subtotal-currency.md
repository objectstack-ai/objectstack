---
'@object-ui/components': patch
---

fix(components): the edit form's roll-up subtotal reads the record's currency, as the record page and the form's tax-inclusive total do

Clause-②: no
Metadata-protocol: none

- A `summary` field that declares its currency (`currencyConfig`, ADR-0144 D6 as amended) now receives the live form record from the form renderer, the way a `currency` field and a `formula` field already do. A `record`-mode roll-up on the New / Edit form therefore draws in the currency its record's code field holds: a EUR invoice's Subtotal reads `€230.00` instead of a bare `230.00`, and it follows the code the user picks.
- Not changed: a roll-up that declares no currency still reads as a number; the record page, the list cell and the line-item grid already drew the record's currency and draw it as before; no metadata changes.
