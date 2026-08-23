---
"@objectstack/rest": patch
---

`GET /api/v1/packages` no longer absorbs a failed durable read into a 200 registry-only listing.

The handler merged two sources — the in-memory registry and the durable `sys_packages` rows read through `PackageService.list()` — and wrapped the durable half in a bare `catch {}` commented "Database query failed — continue with registry-only packages". A read that could not happen was therefore reported as a read that found nothing: the door answered `200` with `{ packages, total }` built from the registry alone, `total` was presented as a COMPLETE count either way, and the registrar-sourced entries kept `source: 'registry'`, which reads as provenance rather than as a warning that the database half is absent. Nothing on the wire separated "these are all the packages" from "these are the packages I could still see".

The durable read is no longer caught at this door. `PackageService.list()` still swallows its own driver faults and answers `[]`, and re-throws only the declared seam refusal introduced alongside it (`SERVICE_UNAVAILABLE` / 503, raised when the storage seam accepted the query and returned no result set) — so that refusal now travels to the client through the existing declared envelope, carrying the producer's own status and code. An undeclared throw becomes a `500 INTERNAL_ERROR` through the same envelope. A durable read that answers is unchanged: both sources still merge, `source` is still `registry` / `database` / `both`, and `total` is still the count of what was really read.

This aligns the two read doors. `GET /api/v1/packages/:id` has no such inner catch and has answered that same refusal since the producer-side change; the list door answering `200` while the detail door refused was the inconsistency.

**Bump level — why `patch` and not `minor` or `major`.** Nothing an author can write changes: no spec key, export, config field, request shape or response shape is added, removed or renamed, so this carries no migration and is not breaking. No capability is added either, so it is not a feature. What changes is that one door stops reporting a failure as a successful complete answer — a correctness fix to an existing contract, and the same disposition the producer-side half of this fix shipped under. Callers that treated a `200` from this door as "the complete package list" were already being told something untrue when the durable read failed; they now receive the declared refusal instead, exactly as they already did from the sibling detail route.
