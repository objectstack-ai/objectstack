---
'@object-ui/data-objectstack': patch
---

feat(data-objectstack): `ObjectStackAdapter.getRecordFieldAccess` reads `GET /data/:object/:id/field-access`

Clause-②: yes (widening)
Metadata-protocol: none

The adapter implements `DataSource.getRecordFieldAccess` through the client's `data.fieldAccess`. A record the read answers 404 for, and a server without the route (501 `NOT_IMPLEMENTED`), resolve to `null`, so the caller keeps its row-blind answer. Any other refusal is thrown, as a read's is.
