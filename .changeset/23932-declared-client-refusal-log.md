---
'@objectstack/rest': patch
---

fix(rest): a client refusal its producer declared is no longer logged as `[REST] Unhandled error` with a stack trace

Clause-②: no

- **What the server log stops printing.** A refused request whose thrown error declares both a 4xx `status` (or `statusCode`) and a registered ADR-0112 `code`, and whose answer carries that same status and code, now prints nothing on the `[REST] Unhandled error` channel every REST route catch shares. Before, each one printed an error-level `[REST] Unhandled error:` line plus the error's full stack, once per request. Two measured cases: a record write whose file violates a field's declared `accept` / `maxSize` (`400 ERR_FILE_CONSTRAINT` on `POST /api/v1/data/:object` and `PATCH /api/v1/data/:object/:id`), and a metadata save that fails spec validation (`422 INVALID_METADATA` on `PUT /api/v1/meta/:type/:name`). Other registered codes thrown with a declared 4xx, such as `FILE_FIELD_BULK_WRITE_REFUSED`, go quiet too, with no per-code list to extend.
- **What still logs, unchanged:** a handler bug or any other undeclared fault (answered `500`); a 4xx that carries no `code` (for example a sandboxed hook's business-rule `400`); a 4xx whose `code` is not registered (it reaches the wire as `declaredCode`); a registered `code` on a status the producer did not declare; a declared `5xx` without `refusal: true`; and a sandboxed body that crashed, whatever it declared. The anonymous public-form submit route keeps its own `[REST] Public form submit error` line as before.
- **Unchanged:** every response's status, `code` and body. Only the server log line moves.
