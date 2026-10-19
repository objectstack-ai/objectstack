---
'@objectstack/core': minor
---

fix(core)!: an API key whose `sys_api_key` read fails is answered as the store outage (`503 SERVICE_UNAVAILABLE`), never as "no key", so the request no longer falls on to a cookie sent beside the key

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes or stores moves: the change is the answer a request gets when the engine's read of `sys_api_key` throws. No spec key, export, option, object definition or stored row is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`resolveApiKeyAdmission` (and `resolveApiKeyPrincipal` and `resolveAuthzContext`, which call it) read the key's row in a bare `catch` that answered "this request carries no key", and logged nothing. Two wrong answers followed on every door that admits API keys:

- **A key-only caller got `401 UNAUTHENTICATED`** during the outage, where a session caller got `503 SERVICE_UNAVAILABLE` for the same fault.
- **A cookie sent beside the key answered for the request.** "No key" sent the request on to the session arm, so a request that led with a key was served as the cookie's user. Measured on the REST data door and the runtime dispatcher (served as the cookie's user) and on the settings door (`200`).

The read now raises the branded `AuthzStoreUnavailableError` (object `sys_api_key`, the driver's error kept as `cause`), the answer the same function already gave when its lifecycle-policy or owner-posture source failed. Every door relays it as `503 SERVICE_UNAVAILABLE`, and the session is never read in the key's place.

- **Unchanged.** A `sys_api_key` table that was never provisioned is still "no key": no key can exist there. This is the boundary `resolveAuthzContext` already draws for its permission reads (the shared `isMissingTableError`). No key header, no engine, no matching row and a row with no `user_id` also still answer "no key".

What to do. Nothing, unless a client treated `401` during a database outage as "the key is bad": it now sees `503` and should retry, not rotate the key.
