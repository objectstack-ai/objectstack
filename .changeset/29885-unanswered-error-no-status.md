---
'@object-ui/data-objectstack': patch
---

Clause-②: no
Metadata-protocol: none

A request that got no answer (a dropped connection, an unreachable host) no longer reads as a server that answered with a 500 (#29885).

- `createErrorFromResponse` now leaves `statusCode` undefined when its input carries no status. Before, it stamped `500`, and `ObjectStackAdapter.getObjectSchema` rewraps through it, so every reader of a schema-read failure took the browser's "Failed to fetch" for the server's own answer. The error is still an `ObjectStackError` with code `UNKNOWN_ERROR`. `classifyLoadError` reads it as `network`, and `answeredLoadFailure` returns `null`, so a failed-read state keeps its "check your connection" sentence.
- An input that is an `Error` is kept as `details.originalError`, whatever its status.
- Answered statuses map as before: 400, 401, 403, 404, 503, 504 and any other status keep their class, code and `statusCode`.
