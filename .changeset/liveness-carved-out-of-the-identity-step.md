---
"@objectstack/runtime": minor
---

`GET /api/v1/health` answers 200 whenever the process can serve HTTP, even while a configuration fault is making every other route 503.

The dispatcher resolves a per-request identity before any route handler runs, and that step reads the tenancy posture for every request — credentialed or not. Since a `tenancy` service that is registered and fails to build is (correctly) re-raised as a 503 rather than absorbed into "there is no posture", an uncredentialed liveness probe was answered 503 for the length of the outage. A liveness probe reads 503 as *restart me*; the service then fails to build again on the new pod. A restart cannot fix a service that cannot build, so the result was a restart loop that hid the very fault the 503 exists to make loud.

**Liveness is now carved out of the identity step.** `GET /health` runs its handler directly: no identity resolution, no configuration read, no credential read — the payload it answers (`status`, `timestamp`, `version`, `uptime`) was already process-local. Wire it to `livenessProbe`.

**Readiness is unchanged, deliberately.** `GET /ready` keeps the full identity step and its 503 body, so traffic is withheld until the fault is fixed and existing operator dashboards keep the signal they have. Wire it to `readinessProbe`. Nothing else about the 503 moved: every other route, and an environment-scoped `/environments/:id/health`, answers exactly as before.

Which routes count as liveness is **derived from the dispatcher's own route table** rather than listed anywhere: a route declares `liveness: true` on its registry entry, and `DomainHandlerRegistry.resolveLiveness()` answers through the same matcher that picks the handler — so the set cannot drift from the routes that exist. `DomainRoute.liveness` and `resolveLiveness()` are additive public surface on `@objectstack/runtime`; a route that does not declare the flag is untouched.
