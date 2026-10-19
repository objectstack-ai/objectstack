---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): global search judges an object's searchable set without its `internal: true` fields, the set the engine scans

Global search (`searchAll`, `GET /api/v1/search`) passes over an object with nothing to scan before it queries. It judged that from the object's fields including `internal: true` ones, which the engine never searches. An object whose only text field is internal therefore passed the skip and reached the engine, which now refuses a search over an empty set, so the whole sweep would have failed. The skip now leaves internal fields out, so such an object is passed over and the sweep answers `200` with the other objects' hits.

What to do. Nothing.
