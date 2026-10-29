---
'@objectstack/objectql': patch
---

fix(objectql): a plugin driver's request-shaped read refusal answers 400 with its own code and message, not 503 "retry later"

Clause-②: no
Metadata-protocol: none

On a datasource served by a plugin driver (a non-managed `schemaMode` on a driver that is not built in), a `find` the driver throws with a request-shaped status (`status` or `statusCode` 400, 404 or 422) now answers `400`: an operator, a combinator, a column or a resource the remote cannot run, which a changed query fixes and a retry never does. The code is the one the driver declared when it is a registered code (`INVALID_FILTER`, for example), otherwise `INVALID_QUERY`; `details.remoteCode` names what the driver declared. The driver's message reaches the caller when the read's filter is the caller's own. When the read carries a predicate the caller did not write (a sharing or row-level security scope), the message is withheld, the answer names the datasource and object and points at the server log, and the driver's text is logged at `warn`. Before, every `find` throw answered `503 ERR_DATASOURCE_UNAVAILABLE` ("It may clear; retry later.") with the driver's reason only in the server log. `find`, `findOne` and `count` all read this way.

Everything else keeps today's answer: a 5xx, an unreachable remote, a throw that declares no status, and 401, 403, 407 and 429 (a credential or rate-limit condition whose text may name the credential) stay `503 ERR_DATASOURCE_UNAVAILABLE`, the text withheld. The refusal is exported as `ExternalReadRefusedError`, with its statuses as `EXTERNAL_READ_REFUSED_STATUSES`. The virtual-objects guide's `refuse()` helper now sets `status: 400`, and its failure paragraph says what the caller sees for each status.
