---
"@objectstack/rest": patch
---

fix(rest): one error envelope across the `/security/explain` pair (#8073)

`registerSecurityExplainEndpoints` — `GET/POST /api/v1/security/explain` and
`GET /api/v1/security/my-delegable-scope` — answered two retired dialects across
its eight refusal arms: the 401 / 501 / 400 / 403 arms were flat
`{ code, message }`, and the two 500s were `{ code, error: 'a bare string' }`. So
`body.error.code`, the one position ADR-0112 D5 declares, read `undefined` on all
six — while the immediately adjacent registrar (`/security/suggested-bindings`,
converged in #7981) already answered the declared shape. A client calling
`explain` and then `suggested-bindings` met two envelopes inside one `security`
family.

Every arm now emits `{ success: false, error: { code, message } }` through the
shared `sendError` from `@objectstack/types` — the same builder every conformant
route module writes through — so the family agrees by construction rather than by
eight literals happening to match. The 400 arm's Zod-issue dump moves from a
top-level `detail` sibling to `error.details`, the slot `ApiErrorSchema` declares
for structured context.

No status code moves, and no code VALUE changes: `UNAUTHORIZED`,
`NOT_IMPLEMENTED`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `EXPLAIN_FAILED` and
`DELEGABLE_SCOPE_FAILED` are all already registered, so nothing in
`packages/spec` moves. `ObjectStackClient` reads both envelopes' declared spots
(`errorBody?.code ?? errorBody?.error?.code`, and a bare-string limb for the
message), so `client.security.explain()` and
`client.security.describeDelegableScope()` keep throwing identical `err.code` and
`err.message` — re-measured against these call paths rather than inherited from
#7981. `err.details` does change on refusals, from "the whole response body" to
the structured slot or the new body.
