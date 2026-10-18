---
'@objectstack/rest': patch
---

REST's request identity door resolves through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition

Clause-②: no

- `RestServer` resolves the caller of every data, metadata and package route by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'reread-when-active'`, `credentials: 'api-key-and-session'`, `sessionApi: 'required'`, `session: 'request'`, its settings lookup for the localization, its own request-locale parse, `accessToken: 'withhold'`, and no OAuth provenance or admission channel. The environment and auth-service resolution, the header normalisation, the data engine, the tenancy wiring, the per-request memo, the `Server-Timing` disclosure and the fail-closed `catch` stay at the door.
- The answers are the ones the door gave before: an anonymous caller gets `401` with the shared body; a session the authentication policy holds gets `403` with its code and message while a gate feature is active; an API key is judged by its own owner's posture; an unreadable permission store, tenancy service or active gate re-read gets `503 SERVICE_UNAVAILABLE`; and an API key its own lifecycle refuses gets its `403` and code.
- One ordering moved, and it shows only when two faults coincide on the single-kernel wiring. The data engine is now resolved before the auth service's session read is asked for. If the configured engine provider fails AND the auth service exposes no session read (or its `getApi()` rejects), the answer is now `503 SERVICE_UNAVAILABLE` (the engine outage) instead of `401`. With a working auth service, the engine outage was already `503`.
- Nothing to do for a consumer: no export, route, configuration key or response shape changed.
