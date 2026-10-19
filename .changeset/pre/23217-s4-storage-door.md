---
'@objectstack/service-storage': patch
---

The storage download door resolves its caller through `@objectstack/core`'s `resolveRequestExecutionContext`, the one request-to-`ExecutionContext` composition

Clause-②: no

- The download authorizer that `StorageServicePlugin` and `mountStorageRoutes` bind for parent-governed files resolves the caller by calling `resolveRequestExecutionContext` with this door's differences as named parameters: `anonymous: 'fail-closed'`, `authGate: 'resolved'`, `credentials: 'api-key-and-session'`, `sessionApi: 'optional'`, `session: 'request'`, its own way to reach the `tenancy` service, `localization: 'withhold'`, no request locale, `accessToken: 'carry'`, and no OAuth provenance or admission channel. The auth-service lookup, the header normalisation, the tenancy wiring, the verdict reads and the fail-closed `catch` stay at the door. The family's ADR-0069 gate reader, which runs before every storage route, is unchanged.
- The answers are the ones the door gave before: an anonymous caller, an unrecognised cookie, a failed session read with no gate active and a refused API key get `401 AUTH_REQUIRED`; a session or an API key owner the authentication policy holds gets `403` with its code and message from the family's gate; an unreadable permission store or tenancy service gets `503 SERVICE_UNAVAILABLE`; and an API key its own lifecycle refuses gets its `403` and code. A one-off probe of 47 fault wirings through the download route read the same answer on both sides of the change.
- The context the door hands to the owner-record read and to a file-access delegate is now the assembled `ExecutionContext` envelope rather than the resolver's raw output: it also states `isSystem: false` and `principalKind: 'human'`, and no longer carries the internal `credential` marker, which no reader of that context consumes.
- Nothing to do for a consumer: no export, route, configuration key or response shape changed.
