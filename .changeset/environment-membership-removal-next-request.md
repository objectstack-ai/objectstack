---
'@objectstack/runtime': patch
---

fix(runtime)!: a member removed from an environment is refused on their next request

Clause-②: no (narrowing) — on a host that enforces environment membership, every request is judged against the membership store as it stands, so a member removed from the environment is refused on their next request, on every replica, and a request whose membership the store cannot answer is answered `503 SERVICE_UNAVAILABLE` whoever was admitted a moment before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest records the check's answer: what moves is when the dispatcher's membership verdict sees a membership change, so there is nothing for a migration to rewrite. -->

**BREAKING** fail-closed narrowing at the environment-membership check (`@objectstack/runtime`'s `HttpDispatcher`, on `dispatch()` and on the declarative-endpoint step that shares its judgment).

- **The rule.** A membership change takes effect on the next request: the check reads the membership store for every scoped request and carries no admission from one request to the next. A member passes, a member of the platform organization passes, a non-member is answered `403 PROJECT_MEMBERSHIP_REQUIRED`, and a store that cannot answer is the outage (`503`, `error.code` `SERVICE_UNAVAILABLE`), never "allowed".
- **Unchanged.** Anonymous requests, the well-known system environment, hosts that turn the check off (`enforceProjectMembership: false`), and compositions that register no environment-member object.
- **Who moves.** Nobody has code to change. A multi-environment host reads its environment-member store once per scoped request. A client may see `403 PROJECT_MEMBERSHIP_REQUIRED` on the request right after a member is removed, and a retriable `503` while the membership store is unreachable, where the request used to be served: retry the `503`, and grant the membership for the `403`.
