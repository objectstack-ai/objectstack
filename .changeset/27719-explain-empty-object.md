---
'@objectstack/rest': patch
---

fix(rest): `security/explain` refuses an empty `object` with `400 VALIDATION_FAILED` instead of a `500 EXPLAIN_FAILED` server fault (#27719)

Clause-②: no — the request already failed; only its answer moves from `500` to `400`.
Metadata-protocol: none

- **Before.** `POST /api/v1/security/explain` with `"object": ""` (or `GET …?object=`) passed the request schema, reached the explain engine, and the engine's plain error was answered `500 EXPLAIN_FAILED` and logged as a server fault.
- **Now.** The door answers `400 VALIDATION_FAILED` in its own envelope, naming the empty key and its remedy, before any evaluation — the same check, in the same place, that refuses an empty `userId`.
- **Unchanged.** A request naming an object is explained exactly as before; an empty `userId` is refused `400 VALIDATION_FAILED` as before; a missing `object` is still refused by the request schema.

**The remedy.** Send the name of the object whose access to explain.
