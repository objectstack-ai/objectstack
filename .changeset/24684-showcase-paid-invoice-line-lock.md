---
'@objectstack/example-showcase': patch
---

fix(showcase): a paid invoice's lines can no longer be added, removed or moved, so its total stays what was paid

Clause-②: no (narrowing) (the showcase refuses two writes it accepted; if the measurement shows the platform half would relax a refusal a faulting rule makes today, the dev stops and reports before building it, and the seat re-declares)

<!-- adr-0087: not-required (unpublished) @objectstack/example-showcase is private: no npm release carries the refused writes, and no author-written key was removed or renamed -->

`readonlyWhen: parent.status == 'paid'` on a line's `product`, `quantity` and `unit_price` locks EDITS of a line under a paid invoice, but it is insert-exempt by design and judges field values, not whether a line exists. So `POST /api/v1/data/showcase_invoice_line` under the paid INV-1003 answered `201`, a `DELETE` of its line `200`, and a `PATCH` moving a line's `invoice` onto or off it `200`, and the paid `total` moved every time.

Three hooks on `showcase_invoice_line` (`src/data/hooks/index.ts`) now refuse each of those writes with a sentence (`400`): `showcase_guard_paid_invoice_line_add` (beforeInsert), `showcase_guard_paid_invoice_line_move` (beforeUpdate) and `showcase_guard_paid_invoice_line_remove` (beforeDelete). Each reads the header invoice under `runAs: 'system'`. A system write passes (the seed loads INV-1003's line under a header that is already paid), and so does the cascade delete of a deleted invoice's lines. A draft or sent invoice's lines add, edit, move and remove as before.
