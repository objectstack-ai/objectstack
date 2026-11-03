---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an unmanaged install-local refusal that points at the server log now writes the log line

Clause-②: no
Metadata-protocol: none

`POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'` answers a refused import with the import's own code and status. When the refusal's message may not be quoted back (it declared its 4xx through `statusCode` or the validation shape rather than a numeric `status`), the answer says "the reason is in the server log". Until now the door wrote that log line only for a 5xx, so a 4xx refusal sent the operator to a log that held nothing about it.

The door now follows one rule at every status: whenever the answer uses that fallback sentence, it writes the `warn` line naming the package, the status, the code and the import's own message. A refusal whose reason reaches the response body writes no line. The status, the code and the response shape are unchanged.
