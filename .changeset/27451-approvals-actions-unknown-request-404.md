---
'@objectstack/rest': patch
---

fix(rest): `GET /api/v1/approvals/requests/:id/actions` answers `404 REQUEST_NOT_FOUND` for a request that does not exist or that the caller cannot see, as its parent door `GET /api/v1/approvals/requests/:id` already did

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the HTTP answer one REST door gives for an approval request the caller cannot read. -->

**BREAKING** (a served-set narrowing) for a caller that reads the action trail of an approval request id that does not exist, or of a request it is not allowed to see. That read used to answer `200 { "data": [] }`. It now answers `404 { "code": "REQUEST_NOT_FOUND", "error": "Approval request '<id>' not found" }`, the same status and body the parent door gives for the same id.

The actions door listed rows without resolving its parent request first, so "this request has no actions yet" and "there is no such request" got the same empty answer. It now asks the parent door's own lookup first, and answers the parent door's own `404`. Both doors share that one lookup. An unknown id and a request outside the caller's visibility still answer alike, so the door reveals nothing about which requests exist.

Unchanged: a request the caller can see keeps its answer, `200 { "data": [...] }` with the same rows in the same order.

**What changes for you.** `ObjectStackClient` already throws on any non-2xx answer, so `approvals.listActions(id)` now rejects with the not-found message for such an id, instead of resolving `[]`. Treat that rejection as "no such request". A caller that reads actions only for requests it got from the request list or the request read is not affected.
