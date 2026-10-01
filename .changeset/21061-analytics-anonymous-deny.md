---
'@objectstack/runtime': minor
---

fix(runtime)!: the analytics dispatcher faces refuse an unauthenticated caller with `401 UNAUTHENTICATED`, like every other data-serving door (#21061)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export, stored shape or wire shape is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. What moves is which callers the analytics dispatcher faces accept: a caller with no session is now refused before the domain reads anything. -->

**BREAKING**: shipped as `minor` under the launch-window convention. The three analytics faces the dispatcher mounts under `/api/v1/analytics` (cube read, SQL echo, meta) now answer a caller without a session `401 UNAUTHENTICATED`, in the dispatcher's wrapped envelope (`{ success: false, error: { code: 'UNAUTHENTICATED', message, httpStatus: 401 } }`). They answered that caller as a guest before.

**What changed.** The analytics domain handler opens with the shared anonymous-deny decision (`shouldDenyAnonymous`, ADR-0056 D2), the same floor the `/data`, `/meta`, `/actions`, `/automation` and `/packages` doors stand on, and the one the REST analytics dataset door already applied. The floor is the handler's first statement:

- it runs before the analytics service is looked up, so an unauthenticated caller gets `401` whether or not the analytics capability is installed, never the `404` an empty slot answers;
- it runs before the request body is validated, so a malformed body from an unauthenticated caller is `401`, never the `400 VALIDATION_FAILED` the entry check answers.

**What is not affected.** A signed-in caller, an API-key caller and an internal system context are served exactly as before: the same `200`, the same `400` for a malformed body, the same `404` when no analytics service is installed. Object admission and the row scope behind the service are unchanged by this release.

**If an analytics call now answers `401`,** it was made without a session: send it with the signed-in user's session or bearer token, or with an API key.
