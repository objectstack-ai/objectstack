---
'@objectstack/scenarios': patch
---

test(scenarios): the `order_to_cash` card asks for a field no object records

Clause-②: no
Metadata-protocol: none

The open card library's `order_to_cash` card gains an eleventh question, `cedar_shipping_charges`: "How much shipping is charged on Cedar Logistics' sales orders?" (zh 「Cedar Logistics 的销售订单上运费一共是多少?」). No seeded object records a shipping charge, so its truth is `unanswerable` and a correct reply says the data does not record it rather than inventing a figure. The card's other unanswerable question asks for an object the app does not have (a commission plan); this one names a field the order itself lacks, the case the data tools answer as not recorded.

The card README's default band is now 8–11 questions (was 8–10), and its per-kind table counts two `unanswerable` turns on `order_to_cash`. The card's sha256 moves, so ask-round records split at the new hash; the verified build is unchanged and reads the same against the new card (Build 174/174), and its provenance re-pins `cardSha256` with an `amended` entry.
