---
"@objectstack/metadata-protocol": patch
---

Declare `saveMetaItem`'s missing-item refusal as a real ADR-0112 envelope: `400` / `INVALID_REQUEST`, was an undeclared throw served as `500 INTERNAL_ERROR`.

`PUT /api/v1/meta/:type/:name` unwraps the `{ item }` / `{ metadata }` envelope shapes before calling the protocol, so a caller sending `{"item": null}` or `{"metadata": null}` reached a guard that declared neither `code` nor `status` — the only refusal in the method that did not. With no status to read, the REST boundary defaulted to a server fault, so an authoring mistake was reported as `500 INTERNAL_ERROR` and the guard's own sentence was withheld by the ADR-0112 disclosure rule and replaced with a generic fallback. Callers now receive `400` with the refusal quoted and the remedy named.

Unchanged: a missing, empty or literal-`null` request body never reached this guard and still answers `422 INVALID_METADATA` from the per-type schema parse. No new error code is introduced — `INVALID_REQUEST` is already registered to this package in the ADR-0112 ledger, and is what the structurally identical opening guard in `rollbackMetaItem` already uses.
