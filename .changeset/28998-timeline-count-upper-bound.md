---
'@objectstack/spec': patch
---

docs(spec): the record-page `timeline` total is documented as an upper bound of the entries the 动态 panel draws

Clause-②: no
Metadata-protocol: none

The `RecordPageTimelineRequestSchema` docblock, and the record-page file header that the API reference page is generated from, now say what the `timeline` total counts: the sources' rows as the schema's table defines them. That makes it an upper bound of the entries the 动态 panel draws, not their number. The panel draws fewer where its `showCompleted` / `types` configuration filters entries out, and where a ledger row has no displayable diff. Prose only: no schema shape, `.describe()` text or behaviour changes.
