---
'@objectstack/runtime': minor
---

fix(runtime)!: the `/ui` and `/data` dispatcher domains decide an anonymous request once, as each domain's first statement, so an unauthenticated caller is answered 401 on every face they serve

ADR-0138 D2 decides that everything off its closed list of six door classes answers 401, and that "the decision is taken once per domain, as the domain's first statement, never surface by surface". The rendered-view domain `/ui` and the CRUD and query domain `/data` made no anonymous decision of their own: an unauthenticated caller was answered by whichever face it named. Each now opens with the shared `shouldDenyAnonymous` decision, before the path is parsed and before any service is resolved, so a face added to either later is refused to an anonymous caller from the day it lands. No door class D2 lists runs through either domain.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the status two runtime dispatcher domains answer an unauthenticated caller with; the remedy is to sign in, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a refusal moved ahead of the answers it used to follow), shipped as `minor` under the launch-window convention for breaking changes.

What an unauthenticated caller is answered now, wherever these dispatcher domains serve the request. Where `@objectstack/rest` is mounted it serves the same paths itself and already answered 401, so the standalone server's answers do not move.

- `/data`: `401 UNAUTHENTICATED` on every read and write face, and on every path or verb the domain does not serve. The answer used to come from the face: the CRUD gate's `403 PERMISSION_DENIED` for the guest, a `400` for a request naming no object, a `428` for an unresolved environment on a multi-tenant host. A CORS preflight keeps its pass.
- `/ui`: `401 UNAUTHENTICATED` on every face, and on every path the domain does not serve.

The refusal is the dispatcher's standard envelope, `{ success: false, error: { code: 'UNAUTHENTICATED', message, httpStatus: 401 } }`, with the shared message every other dispatcher domain answers with. Nothing a signed-in caller is served changes. The decision is asked about the caller's user id, as the `/notifications` and `/keys` floors ask it: `dispatch()` resolves identity for every request, so no caller on the wire is a system context, and an in-process call of either handler that passes a system context with no user id is refused too.
