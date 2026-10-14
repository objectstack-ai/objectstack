---
'@objectstack/runtime': minor
---

fix(runtime)!: the notification inbox, API-key mint and share-link management dispatcher domains decide an anonymous request once, as each domain's first statement, so an anonymous caller is answered 401 whatever the deployment carries

ADR-0138 D2 decides that everything off its closed list of six door classes answers 401, and that "the decision is taken once per domain, as the domain's first statement, never surface by surface". Three dispatcher domains decided it per face, below another answer: `/notifications` below its inbox capability probe, `/keys` below its method check, and `/share-links` inside its management faces, below the share-link service probe. Each now opens with the shared `shouldDenyAnonymous` decision, before any service is resolved and before any face is chosen, so a face added to one of them later is refused to an anonymous caller from the day it lands.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the status three runtime dispatcher domains answer an unauthenticated caller with, on compositions where another answer used to come first; that caller was refused before and is refused now, and the remedy is to sign in, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a refusal moved ahead of the answers it used to follow), shipped as `minor` under the launch-window convention for breaking changes.

What an unauthenticated caller is answered now, on each domain:

- `/notifications`: `401 UNAUTHENTICATED` on every face. On a deployment with no inbox (a send-only notification provider, or none) the anonymous answer was the `501` capability answer; it is now the 401, and a signed-in caller there still gets the 501.
- `/keys`: `401 UNAUTHENTICATED` for every verb. A verb other than `POST` used to be answered `405` to an anonymous caller; a signed-in caller still gets the 405.
- `/share-links`: `401 UNAUTHENTICATED` on the create, list and revoke faces and on every path the domain does not serve. On a deployment without the share-link service the anonymous answer was `501`; a signed-in caller there still gets the 501. The two token faces, `GET /share-links/:token/resolve` and `GET /share-links/:token/messages`, are unchanged: the capability token admits them (ADR-0138 D2 class 2).

The refusal is the dispatcher's standard envelope, `{ success: false, error: { code: 'UNAUTHENTICATED', message, httpStatus: 401 } }`, with the shared message every other dispatcher domain answers with, so a client reads one anonymous refusal on all of them. Nothing a signed-in caller is served changes, and on the standalone server the booted showcase already answered 401 on the faces it mounts.
