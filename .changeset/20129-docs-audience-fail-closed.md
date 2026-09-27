---
"@objectstack/rest": patch
---

**The docs reads fail closed when a gate input cannot be read.** `GET /api/v1/meta/doc/:name` and `GET /api/v1/meta/doc` decide whether a caller may read a doc from the environment's books and, on the single read, the doc corpus those books claim over. A thrown read of either was treated as an empty list — and to the audience resolver an empty book list means "no `{ permissionSet }` book anywhere" (every doc readable by any signed-in member), and an empty corpus means "no book claims this doc" (so its audience is `org`). A metadata-store fault on those reads therefore served a permission-set-gated doc, **body included**, to a signed-in member who does not hold the set, and listed it for them.

Now the fault is answered as the fault it is, through the route's error door — the same answer `GET /api/v1/meta/book/:name/tree` has always given when its own book read fails, so the three docs reads answer one fault one way. With `@objectstack/metadata-protocol` that is `503` / `SERVICE_UNAVAILABLE`: retry once the metadata store is reachable. While the store is failing, no doc is served or listed, because without the books the gate cannot tell which docs a gated book claims. Healthy reads answer exactly as before (`200` to a holder, `403` / `PERMISSION_DENIED` to a non-holder, `401` / `UNAUTHENTICATED` to an anonymous caller).

Nothing to change in your metadata or your clients. A client that treated a `200` from these reads during a store outage as authoritative now sees the outage instead.
