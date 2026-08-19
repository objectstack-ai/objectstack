---
"@objectstack/spec": minor
---

Declare `organizationId` on the metadata read request schemas — `GetMetaItemsRequestSchema`, `GetMetaItemRequestSchema` and `GetMetaItemCachedRequestSchema` — matching the member the protocol implementation has accepted and honoured all along (it selects the org partition in the ADR-0005 overlay read order, deciding which tenant's customization rows are served; on the cached read it also enters the ETag). Also declares `GetMetaItemLayeredRequestSchema` (+ `GetMetaItemLayeredRequest`), the request shape of `GET /api/v1/meta/:type/:name/layers`, mirroring the implementation's parameter type member for member alongside the already-declared layered response schema. Accept-set widening catch-up only: no runtime behaviour changes, and requests without `organizationId` remain valid environment-wide reads.
