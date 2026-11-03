---
'@objectstack/service-automation': patch
---

fix(service-automation): a held connector instance's ERROR record carries its reason, and the connection door's refusal sentence ends with one period

Clause-②: no — log meta and one character of refusal text; no schema, accept set, error code or status moves
Metadata-protocol: none

- **Log.** When a provider-bound connector instance is held as a configuration fault that the platform itself refuses (an `oauth2` instance this server cannot serve: an MCP server over plain `http://` off loopback, an endpoint not over https, no endpoints to discover), the `failed to materialize connector instance` ERROR record printed `{"error":"undefined"}`, because there was no thrown value to describe. It now carries the reason in its meta (`reason`), the same sentence the degraded instance stores. A fault that is a thrown provider error still logs that error in `error`, as before. The WARN line and the hold itself are unchanged.
- **Retried instance, same record shape.** An `authorization_code` instance whose connections could not be read is degraded and retried on the backoff with no thrown value either; its `retrying with backoff` ERROR record printed `{"error":"undefined"}` too, and now carries `reason` the same way. A provider error that degrades an instance still rides `error`.
- **Refusal text.** `GET`/`POST /api/v1/automation/connectors/NAME/connection` answered such an instance's `400 VALIDATION_ERROR` with the sentence followed by a second period ("… only to a loopback host.."). The door now answers the sentence as the instance's degraded reason states it, ending once.
