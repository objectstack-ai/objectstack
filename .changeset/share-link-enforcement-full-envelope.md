---
"@objectstack/spec": minor
---

feat(spec): share-link enforcement takes the full `ExecutionContext`; the narrow context is route-401 only (#6430, #6206 ruling A)

`IShareLinkService.createLink` / `revokeLink` / `listLinks` now declare their
context parameter as the complete `ExecutionContext` envelope instead of the
five-field `ShareLinkExecutionContext`. All three ADJUDICATE access — the
[Finding-2] visibility re-read on create, the ADR-0111 D8 share-manager probe
on revoke, the context-scoped listing — so each needs the whole
`resolveAuthzContext` result, `accessible_org_ids` / `org_user_ids` /
`systemPermissions` / `posture` / `tabPermissions` included.

The measured failure behind the ruling: the share-link route assembled exactly
those five fields and handed the result straight to `engine.find` as the
enforcement context. Under the `group` tenancy posture `accessible_org_ids` IS
the Layer 0 wall (ADR-0105 D2) and an absent set denies, so link creation
returned a blanket 403 on a posture that ships. Fail-closed, not a leak — but a
trimmed envelope feeding enforcement is a bypass-shaped pattern, and ADR-0095
D2 already rules that posture is resolved once and carried, never re-derived at
the enforcement site. This was the third assembly site of that family (#5997,
#6071), so the contract converges on the whole envelope rather than keeping a
per-site subset.

`ShareLinkExecutionContext` is retained and unchanged in shape — it is the
route's own "authenticated or 401?" vocabulary — with TSDoc that now states the
boundary and why TypeScript cannot enforce it (structural subtyping accepts a
narrow object wherever the wide type is expected, so the declared parameter
type plus the caller's obligation are what hold the line).

Contract-only, no runtime behaviour change here: existing implementations keep
compiling (method parameters are bivariant), and the `@objectstack/plugin-sharing`
consumer that actually threads the envelope through is the follow-up half
tracked on #6206.
