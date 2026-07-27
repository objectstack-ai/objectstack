---
"@objectstack/client": minor
"@objectstack/rest": patch
---

feat(client): close the 9 metadata-family REST gaps the #3587 ledger carried (#3587)

New `meta` surface: `getDiagnostics` (spec-validation sweep), `getReferences`
(reverse references), `getBookTree` (ADR-0046 §6 spine resolution), `getAudit`
(ADR-0010 §3.6 protection trail), `publishItem` / `rollbackItem` / `diffItem`
(ADR-0033 per-item draft lifecycle). The two compound-name routes
(`GET|PUT /meta/:type/:section/:name`) turned out to be already expressible —
`getItem`/`saveItem` pass slashes through unencoded — so they are flipped to
`sdk` with URL-pinning tests instead of new methods (the audit note claiming
an encoding barrier was wrong; only `deleteItem` encodes). REST route-ledger
ratchet: 43 → 34.
