---
'@objectstack/service-settings': patch
---

The settings routes' identity door resolves through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition

Clause-②: no

- `SettingsServicePlugin` resolves the caller of every `/api/settings` route by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'resolved'`, `credentials: 'api-key-and-session'`, `sessionApi: 'optional'`, `session: 'request'`, its own way to reach the `tenancy` service, `localization: 'withhold'`, no request locale, `accessToken: 'withhold'`, and no OAuth provenance or admission channel. The engine and auth-service lookups, the header normalisation, the tenancy wiring, the projection to `SettingsContext` and the fail-closed `catch` stay at the door.
- The answers are the ones the door gave before: an anonymous caller, an unrecognised cookie, a failed session read and a refused API key get `401 UNAUTHENTICATED`; a session or an API key owner the authentication policy holds gets `403` with its code and message; an unreadable permission store or tenancy service gets `503 SERVICE_UNAVAILABLE`; and an API key its own lifecycle refuses gets its `403` and code. A one-off probe of 29 fault wirings through the listing route read the same answer on both sides of the change.
- Nothing to do for a consumer: no export, route, configuration key or response shape changed.
