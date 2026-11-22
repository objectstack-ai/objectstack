---
'@object-ui/plugin-grid': patch
---

fix(grid): on a phone's card list, while a selection is open, a tap on a link inside a card ticks or unticks the card

Clause-②: no
Metadata-protocol: none

A tap on a card's email, phone number, URL, referenced record, image, copy button or 「⋮」 used to open the link, the record or the menu instead of ticking the card. While a selection is open the card now takes every tap inside it, as phone apps do in selection mode; the click that ends the long press which starts a selection opens nothing either. When the selection ends, the same taps open their links again. The desktop table is unchanged.
