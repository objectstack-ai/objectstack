---
'@objectstack/runtime': patch
---

fix(runtime)!: a signed-in caller is never admitted to an environment because the membership check could not read its session

Clause-②: no (narrowing) — on a host that enforces environment membership, a signed-in caller the identity step admitted with a session is judged as the principal the request resolved, in the organization its resolution vetted, the way an API-key or OAuth principal already was. Where an input the check needs cannot be read, it answers `503 SERVICE_UNAVAILABLE` and never admits. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest records the check's answer: what moves is the dispatcher's membership verdict on one request, so there is nothing for a migration to rewrite. -->

**BREAKING** fail-closed narrowing at the environment-membership check (`@objectstack/runtime`'s `HttpDispatcher`, on `dispatch()` and on the declarative-endpoint step that shares its judgment).

- **The rule.** The check judges the principal the request resolved, whichever credential admitted it, and an input it cannot read is the outage (`503`, `error.code` `SERVICE_UNAVAILABLE`), never "allowed". A member still passes, a member of the platform organization still passes, and a non-member is answered `403 PROJECT_MEMBERSHIP_REQUIRED`.
- **Unchanged.** A request no credential admitted (anonymous) is not judged here, and upstream auth decides, as before. The well-known system environment stays open to every signed-in caller. A host that turns the check off (`enforceProjectMembership: false`), and a composition that registers no environment-member object, are untouched.
- **Who moves.** Nobody has code to change. A client of a multi-environment host may now see `403 PROJECT_MEMBERSHIP_REQUIRED` for a signed-in non-member, or a retriable `503` while an authorization store is unreachable, where the request used to be served: retry the `503`, and grant the membership for the `403`.
