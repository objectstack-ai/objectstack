---
"@objectstack/runtime": minor
---

feat(security): the endpoint-route 401 anonymous-deny body carries `code: "UNAUTHENTICATED"` alongside the existing `error` / `message` keys (#9823)

Service-declared endpoint routes (`RouteDefinition` emitted via hooks, e.g.
`buildAIRoutes()` — any route whose `auth` is not explicitly `false`) answered
an anonymous caller `401 { error, message }` with no `code` key: the
`mountRouteOnServer` 401 arm wrote an inline copy of the flat deny body, so
the #9487 constant change (`@objectstack/core`'s `ANONYMOUS_DENY_BODY`) never
reached it, and through `@objectstack/client` a caller's `err.code` stayed
`undefined` for exactly these 401s.

The arm now writes the shared `ANONYMOUS_DENY_BODY` / `ANONYMOUS_DENY_STATUS`
verbatim, so the body gains `code: "UNAUTHENTICATED"` and this seam can no
longer drift from the constant it was copied from. **Additive only**
(maintainer-ruled on #9487): no key is removed or moved — `error` keeps
holding the same code value it always has, so every existing reader keeps
working. This does not settle ADR-0112 D5 (flat vs nested envelope
convergence, #9559); the envelope family of this arm is unchanged in kind.
