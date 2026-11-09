---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): a catalog list query the public marketplace snapshot cannot evaluate is answered by the cloud

Clause-②: no
Metadata-protocol: none

With `OS_MARKETPLACE_PUBLIC_BASE_URL` set, the marketplace proxy answers `GET /api/v1/marketplace/packages` from the public snapshot and filters and pages it itself. It evaluates `q`, `limit`, `offset`, `maturity` and the `businessFunctions`, `industries` and `solutionTypes` facets, and it used to ignore every other key: a `?languages=zh-CN` read answered the whole catalog with 200 (or, with `limit`/`offset`, a page filtered by everything except the languages), and the cloud's facet counts were dropped from the re-serialized page. Nothing told that answer apart from a filtered one.

A list request that carries any key the snapshot does not evaluate now takes the cloud path, which receives the query string verbatim: the same answer, counts included, as a runtime without the snapshot configured. Requests made only of the keys above are still answered from the snapshot. Nothing to do on upgrade; a `languages` read on such a runtime now needs the cloud to be reachable, and answers the existing `502 MARKETPLACE_PROXY_FAILED` when it is not.
