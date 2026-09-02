---
'@objectstack/driver-turso': patch
'@objectstack/spec': patch
---

drivers(turso): an unsafe identifier on the remote transport answers `400 INVALID_REQUEST`, not an opaque 500

`RemoteTransport.assertSafeIdentifier` is the one gate for every position where
an identifier is inlined into SQL — the `object`, `field` and `groupBy`
field/output-key positions of `aggregate`, the table and column names in
`syncSchema` / `syncSchemasBatch`, and the index name and columns in unique-index
sync — plus the free function of the same name in the remote canonical backfill.
All of them threw a bare `Error` with no `code` and no `status`, so `mapDataError`
reached none of its classifying branches and served a sanitised **500**: a caller
whose own identifier was refused was told the server had faulted, and an SDK
reading a 5xx retries a request that can never succeed.

Every one of those refusals now carries the ADR-0112 envelope `code:
'INVALID_REQUEST'`, `status: 400`, built by one constructor so the positions
cannot answer three ways. `@objectstack/spec` gains only the error-code ledger's
provenance row registering this driver as an emitter of a code seven packages
already register — the registered-code union is byte-identical (248 codes before
and after) and no new code is minted.

**Nothing about which identifiers are refused changed.** `SAFE_IDENTIFIER` and
every refusal message are untouched; exactly the inputs refused before are
refused after, with byte-identical prose. Only `code` and `status` are new.
