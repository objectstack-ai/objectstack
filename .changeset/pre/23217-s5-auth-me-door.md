---
'@objectstack/plugin-hono-server': patch
---

The `/auth/me` endpoints resolve their caller through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition

Clause-②: no

- `makeExecutionContextResolver`, which `GET /auth/me/permissions`, `GET /auth/me/localization` and `GET /me/apps` call, resolves the caller by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'withhold'`, `credentials: 'session-only'`, `sessionApi: 'required'`, `session: 'request'`, no tenancy posture, `localization: 'withhold'`, no request locale, `accessToken: 'withhold'`, and no OAuth provenance or admission channel. The per-request service reads, the environment-kernel resolution and the fail-closed `catch` stay at the door. Every platform door that resolves a request's caller now calls the one composition.
- One answer changes. When the auth service's session read carries `session.userId` but no `user.id` (no user object, a user without an id, or `user.id: null`), these endpoints answered as signed out; they now answer as signed in as that user, which is how the runtime dispatcher, REST, the settings routes and the storage download already read it. No session producer yields that shape: in this repository better-auth's session read returns no session when the session's user is missing and plugin-auth passes its read through, and cloud's control plane uses the same plugin-auth read.
- Every other answer is unchanged: no credential, an unrecognised cookie, a failing session read, an API key alone and a host with no auth service get each route's signed-out body; a session the authentication policy holds is still served on these allow-listed routes, with no `authGate` on its context; an unreadable permission store is still the host's `503 SERVICE_UNAVAILABLE`.
- Nothing to do for a consumer: no export, route, configuration key or response shape changed.
