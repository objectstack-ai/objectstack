---
'@objectstack/rest': patch
---

Clause-②: no
Metadata-protocol: none

`POST /analytics/dataset/query` with a `datasetName` now answers `503 SERVICE_UNAVAILABLE` when the saved-dataset read itself fails (for example, the metadata store is unreachable), instead of `404 NOT_FOUND` "Dataset … not found.". The answer says the dataset read failed and that this is a server-side fault, not a missing dataset; the store's own error text is withheld from the client and logged for the operator. This matches the AI tool `query_dataset`, which answers the same failed read `503 SERVICE_UNAVAILABLE`. A read that succeeds without the name still answers `404 NOT_FOUND`, unchanged.
