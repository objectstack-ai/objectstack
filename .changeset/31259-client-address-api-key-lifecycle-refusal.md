---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the organization client-address read answers a revoked or expired API key with the key's own refusal, not a 500

Clause-②: no
Metadata-protocol: none

`GET /api/v1/auth/client-address` resolves its caller through the settings door's composition, which admits an API key. A key its own lifecycle refuses (revoked, expired, inactive) was answered `500 INTERNAL_ERROR` with an error log line. The route now relays that refusal as the error declares it: `403` with `API_KEY_REVOKED`, `API_KEY_EXPIRED` or `API_KEY_INACTIVE` and the refusal's located message, as the settings routes and REST already answer the same key, and logs nothing for it. The `503` store-outage answer, the `401` / `403` admission refusals and an organization administrator's answer are unchanged.
