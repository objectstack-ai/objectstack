---
'@objectstack/runtime': minor
---

fix(runtime)!: the runtime dispatcher's ADR-0069 gate answers `503` when an active gate cannot read the session, as REST does

Clause-②: no (narrowing) — an active gate's outage now refuses what it served; core's existing exports only, no published schema or export moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at one seam, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and every request whose session read answers receives the same answer as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is one window: while an ADR-0069 gate feature is active and the dispatcher's gate cannot read the session, the request is now refused with `503 SERVICE_UNAVAILABLE` instead of being served. The other categories are closed on facts: `@objectstack/runtime` publishes (not unpublished); no ADR-0087 id covers this seam and this diff adds none (not registered / already-registered); and no published interface or type changes, the method being private (not runtime-interface-only / type-surface-only / runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled. While a gate feature is active, the runtime dispatcher (`HttpDispatcher`) reads the session again at its own gate to ask that question. When that read failed, because the auth service could not answer, the dispatcher took the failure for "no session" and served the request, so a session the policy holds passed the gate on every dispatcher-served route for as long as the outage lasted. REST, and the dispatcher plugin's declared-endpoint fallback, answer the same window `503`.

- **Refused now:** with a gate feature active, a request whose gate read fails (the session read rejects, or the auth service cannot hand back its session API) is answered `503` with the code `SERVICE_UNAVAILABLE`, in the dispatcher's existing error envelope. It is the authorization-store outage (`AuthzStoreUnavailableError`, `@objectstack/core`, read object `auth_gate`) that REST raises for the same window, and the route's own handler does not run.
- **Unchanged:** with no gate feature active the gate makes no read at all, and a deployment whose gate probe itself fails is treated as having no active gate, as on REST. Whenever the read answers, the answers are as before: a held session gets the gate's `403` with its own `code`, and a session the policy does not hold, an API-key caller and an anonymous caller are served as before.

What changes for you. Only deployments with password expiry or enforced MFA turned on are affected, and only while their auth service cannot answer a session read: requests on routes the runtime dispatcher serves now answer a retriable `503` instead of being served. Retry once the auth service answers. Nothing needs configuring.
