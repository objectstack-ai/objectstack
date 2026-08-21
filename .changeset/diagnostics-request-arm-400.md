---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `getMetaDiagnostics` refuses an unrecognised `type` spelling with the producer's 400 instead of answering "scanned 1 type, 0 problems" (#8924)

<!-- adr-0087: not-required (no-migration-prescription) The same one-method
`catch` #8855 narrowed is narrowed once more: the request-classification 400
`canonicalizeMetaRequestType` already raises inside `getMetaItems` is rethrown
the same way the 503 is. No authorable key is added, renamed, retired or
tombstoned, no stored shape changes, and the response payload type is
byte-identical — there is nothing for a conversion entry to convert. -->

This is a **narrowing that makes an already-classified 400 reach the caller**.
`GET /api/v1/meta/diagnostics?type=<unrecognised-plural-of-a-declared-type>`
(and the SDK method `client.meta.getDiagnostics({ type })`) used to answer
`200 {"entries":[],"total":0,"scannedTypes":1,"scannedItems":0,"stats":{}}` —
"scanned 1 type, no issues" — for a spelling every sibling `/meta` door
refuses with a 400 that names both accepted spellings. The producer had
already classified the mistake (`status: 400`, `code: 'INVALID_REQUEST'`,
raised by `canonicalizeMetaRequestType` inside `getMetaItems`); the
diagnostics sweep's per-type `catch` swallowed the verdict into a benign
skip, and `scannedTypes: 1` then published a sweep that scanned nothing as
coverage. Maintainer ruling 2026-08-20: rethrow the 400 the same way #8855's
fix rethrows the 503.

**Measured on a booted kernel (real HTTP), before → after:**

```
GET /api/v1/meta/diagnostics?type=fieldes   200 {"scannedTypes":1,"stats":{}}  →  400 [invalid_request] "… Address it as 'field' or 'fields'."
GET /api/v1/meta/diagnostics?type=fields    200 (recognised plural)            →  200 unchanged
GET /api/v1/meta/fieldes                    400                                →  400 unchanged
```

What is unchanged: recognised plurals (`fields`, `views`, …) still fold and
answer; a name that is a plural of nothing (`fieldz`) still answers an honest
`count: 0` entry; a genuine, unclassified listing failure still skips that
one type instead of failing the sweep; the whole-corpus sweep (no `?type=`)
cannot produce the refusal at all — its target set comes canonical out of the
registry. A caller that treated the old `200`-with-empty-stats answer as
"clean" now hears the refusal that names the accepted spellings.
