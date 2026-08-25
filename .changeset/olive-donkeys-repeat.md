---
'@objectstack/rest': patch
---

fix(rest): classify a refusal by what the producer declared, not by how its message starts

The three record-share routes and `POST /api/v1/analytics/dataset/query` each
built their error answer by hand and shared no branch with the door every
`/data` face reports through, so one refusal got a different wire answer
depending on which route caught it. Both now ask that door first, through a
single new seam (`classifiedRefusalAnswer`), for a refusal the **producer
classified** — a declared 4xx `status`/`statusCode` **plus** a `code`, or a
sandboxed hook body's business `throw`. Everything else is untouched.

**Per route, old answer → new answer.** Check your error handling if you branch
on any of these.

`GET /api/v1/data/:object/:id/shares`, `POST` the same path, and
`DELETE /api/v1/data/:object/:id/shares/:shareId`:

| the thrown refusal | was | is now |
| :--- | :--- | :--- |
| `{ code: 'RECORD_LOCKED', status: 409 }` (any code outside the five prefixes) | `500` `SHARES_LIST_FAILED` / `SHARE_GRANT_FAILED` / `SHARE_REVOKE_FAILED` | `409` `RECORD_LOCKED` |
| `{ code: 'FORBIDDEN', status: 403 }` — `plugin-sharing`'s own write gate | `500` `SHARE_*_FAILED` | `403` `FORBIDDEN` |
| the same declared as `statusCode` rather than `status` | `500` `SHARE_*_FAILED` | the declared status + code |
| a sandboxed hook refusal, no status declared | `500` `SHARE_*_FAILED`, message = the QuickJS wrapper `hook '<name>' threw: Error: <text>` | `400` `VALIDATION_ERROR`, message = the hook's own sentence |
| a sandboxed hook body that CRASHED | `500` `SHARE_*_FAILED`, message = the wrapper around `TypeError: …` | `500` `SHARE_*_FAILED`, message = `Internal server error` |
| `VALIDATION_FAILED:` / `PERMISSION_DENIED:` / `NOT_FOUND:` / `CONFLICT:` / `SHARING_NOT_ENABLED:` prefixed messages | 400 / 403 / 404 / 409 / 422 with the prefix stripped | **unchanged** |
| anything else | `500` `SHARE_*_FAILED` with its own message | **unchanged** |

`POST /api/v1/analytics/dataset/query`:

| the thrown refusal | was | is now |
| :--- | :--- | :--- |
| a sandboxed hook refusal, no status and no code declared | `500` `{ code: 'ANALYTICS_QUERY_FAILED', error: <text> }` | `400` `{ message: <text> }` — the same status `POST /api/v1/data/:object` answers for the identical throw, and no code, because the producer declared none |
| a declared 4xx + code spelled `statusCode` rather than `status` | `500` `ANALYTICS_QUERY_FAILED` | the declared status + code |
| a declared 4xx + code spelled `status` | the declared status + code | **unchanged** |
| a declared 5xx, a crashed hook body, a driver fault, anything unclassified | `500` `ANALYTICS_QUERY_FAILED` | **unchanged** |

The nested `{ success: false, error: { code, message } }` envelope the sharing
family answers is unchanged — only the status and code inside it move. The
`VALIDATION_ERROR` on the sandbox row is the catalog's declared floor for a
required `code` the producer did not name (`standardErrorCodeForHttpStatus`);
the flat `/data` body omits `code` there instead, because its `code` is
optional and ADR-0112 invents nothing.
