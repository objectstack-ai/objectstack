---
"@objectstack/client": minor
---

feat(client): `security.explain()` accepts the `recordIds` batch spelling (#8480)

The typed `security.explain()` request now declares the optional
`recordIds?: string[]` field alongside the existing `recordId?: string`, so a
typed-client consumer can reach the batch record-grained explain form added
server-side by #8326 without a cast. Type-level and TSDoc only — the method
still forwards the request body verbatim over POST; the 200-id cap and the
`recordId`/`recordIds` mutual exclusion are validated server-side by
`ExplainRequestSchema` (`@objectstack/spec`), unchanged.
