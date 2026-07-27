---
"@objectstack/client": minor
"@objectstack/rest": patch
---

feat(client): close the final 9 REST gaps — ratchet 9 → 0 (#3587 batch 5/5)

`data.clone` (enable.clone duplication) and `data.export` (streaming
CSV/JSON/XLSX; returns the raw `Response` — a file stream, not a JSON
envelope). New `email.send` (IEmailService; branch on the returned `status`).
`analytics.queryDataset` speaks the ADR-0021 REST dataset-query dialect. New
`datasources.external.*` federation admin: `listTables` / `draft` / `import` /
`refreshCatalog` / `validate` (ADR-0015 Addendum, 503-degrading). Every REST
route is now either SDK-expressed or carries a reviewed non-sdk disposition —
the #3587 gap ratchet rests at ZERO.
