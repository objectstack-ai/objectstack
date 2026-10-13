---
"@objectstack/core": minor
---

feat(core): the ADR-0069 auth-gate allow-list admits the ADR-0043 approval action route, `approvals/act`, as one exact route

Clause-②: yes

- **What the allow-list admits now.** `isAuthGateAllowlisted` answers `true` for the approval action route `approvals/act`, at the mount bases the gate already recognises (`/api/v1/approvals/act`, `/api/approvals/act`, and the dispatcher's prefix-stripped `/approvals/act`), unscoped or under one `/environments/<id>` (or legacy `/projects/<id>`) scope, with the query string and trailing slashes stripped as for every other entry. Nothing else moves: `/approvals/act/<anything>`, `/approvals/actx`, the approvals base and every `/approvals/requests/…` route stay gated.
- **Why this is not a loosening.** ADR-0043 authenticates the action page by its single-use token alone, and `plugin-approvals`' self-hosted mount (`GET` renders, `POST` redeems on the host app) has never passed through this gate. The entry gives the dispatcher's spelling of the same route the same token-only authentication, so a session held by an authentication policy (expired password, required MFA) is no longer refused there with that policy's `403` before the token is read.
- **Effect on a kernel whose dispatcher serves no `/approvals/act` domain.** A held session that reaches the route gets the dispatcher's `404 ROUTE_NOT_FOUND`, the answer every other caller already gets there, instead of the policy's `403`. Nothing on the REST surface is affected: no REST route serves `approvals/act`, and no shipped seam passes a path to `shouldDenyAnonymous`.
