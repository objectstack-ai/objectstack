---
'@object-ui/components': patch
---

fix(components): a New Invoice in the home currency fills a picked product's price on its line again

Clause-②: no

The currency code picker's trigger now carries the selected code as its `value`, and a changed code bubbles a `change` event from it, as a native select does. The master-detail form reads its header's live values off the header's named elements, and read this one as empty: since the line grid withholds a picked amount from a line whose currency it cannot tell (objectstack#36249), a New Invoice in the home currency left Unit Price empty with the note "no currency is chosen here yet". The grid now reads the header's code once the header has been edited, and reads a picked code when it is picked. A line picked before any header edit still withholds the price and says so.
