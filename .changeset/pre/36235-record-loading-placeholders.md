---
'@object-ui/plugin-detail': patch
'@object-ui/console': patch
---

fix(console): while a record loads, the record drawer's title shows a placeholder instead of the record's internal id, and a related list's count badge waits for its count instead of showing 0

Clause-②: no
Metadata-protocol: none

On a slow network the record drawer named the record `#8e25d44e…` until its read landed, and every related list's header read 「0」 before its rows arrived — a false "no related records". The drawer's record row now draws a placeholder until the record reports its name (a loaded record with nothing to be named by still shows its short id, and a read that ends without a record — not found, refused, failed — names the object instead), and a related list or compact related card draws no count until its count is known; a list whose read really comes back empty still shows 0.
