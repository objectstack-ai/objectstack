---
'@objectstack/spec': patch
---

docs(spec): the record-page `timeline` total's published description reads it as an upper bound of the drawn 动态 entries

Clause-②: no
Metadata-protocol: none

`RecordPageTimelineCountSchema.total`'s `.describe()`, which ships in the published JSON schema and the API reference, and the schema's docblock now say what the `RecordPageTimelineRequestSchema` docblock says: the total counts the rows of the sources the request named, as that schema's table defines them and as the caller may read them. That makes it an upper bound of the entries the 动态 panel draws, not their number. The panel draws fewer where its `showCompleted` / `types` configuration filters entries out, and where a ledger row has no displayable diff. Description text only: no key, type, bound, default or export changes, and no behaviour changes.
