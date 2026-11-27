---
'@objectstack/scenarios': patch
---

fix(scenarios): the seed leaves out the card values of the build's roll-ups, so a roll-up is derived from the rows the seed sends instead of stored as the end state

Clause-②: no
Metadata-protocol: none

A scenario card states every row as of its `asOf`, roll-up totals included: order_to_cash's 95 invoices carry `amount_paid` equal to the sum of their payments. The seed path stores a roll-up value it is sent as written, so a build that declares `amount_paid` a `summary` of its payments and caps a payment at the invoice's open balance read every paid invoice as owing nothing and refused 66 of its 72 payments.

`seedApp` now leaves out each card column the build declares a roll-up (`type: 'summary'`), and names them in the run record's `seed.leftOut` (`object.field`). The platform starts a left-out `count` / `sum` roll-up at 0 and adds each child row as it lands, so the invoice ends at the card's value and every payment loads. A restore re-inserts a seeded row with the same body. A formula or autonumber value is still sent: an autonumber is a name the questions cite (`INV-1058`). The card and its committed build are unchanged; a build that stores `amount_paid` as a plain number is still sent the card's value.
