---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation names the inbound hook's answer for a disabled package's flow, and the refusal of an undeclared `connector_action` input key

Clause-②: no
Metadata-protocol: none

The inbound hook section gains one bullet: a flow whose package is disabled answers the door's `401 INVALID_SIGNATURE` at both its bare and its qualified address, with nothing enqueued, and a sender's retry is accepted (`202`) once the package is enabled. Text only; the neighbouring bullets are tightened to pay for it.

The `connector_action` row and the integration recipes now say that an input key the action's `inputSchema` does not declare fails the step before dispatch, and that on an OpenAPI document nobody de-referenced a `$ref` parameter or a `$ref` / schemaless request body reads as open input, sent unjudged (a `$ref` response is still silently lost).
