---
'@objectstack/rest': patch
---

fix(rest): `GET` / `POST /security/explain` answers a refusal the security service classified with that refusal's own status and code, instead of `500 EXPLAIN_FAILED` (#20603)

Clause-②: no

The explain service can refuse a request with an ADR-0112 envelope: a `code` and a 4xx `status`. The measured case is a row-level policy that the record matcher cannot evaluate. The service then answers `INVALID_FILTER` / 400, the same answer the find it explains gives for that filter. This happens for a record-grained explanation (`recordId`), for an object-level explanation, and for a `recordId` that no row carries.

The route's error handler recognised only `PERMISSION_DENIED` (403) and `OBJECT_NOT_FOUND` (404). Every other throw answered `500` with `error.code: 'EXPLAIN_FAILED'`. So through HTTP the explain call reported a server fault, while the find it explains reported the caller's error. A client reading that 500 retries or reports an outage, where the platform means "this policy cannot be evaluated".

The route now asks the same classification the `/data` door uses. A throw that declares a 4xx `status` (or `statusCode`) and a `code` answers with that status and that code in the nested envelope, `{ success: false, error: { code, message } }`. The message is bounded the way `/data` bounds a refusal's message.

Unchanged:

- A throw that is not classified still answers `500 EXPLAIN_FAILED`. That covers a plain `Error`, a declared 5xx, and a `code` with no `status`.
- The `403 PERMISSION_DENIED` and `404 OBJECT_NOT_FOUND` answers.
- A successful explanation's body.
