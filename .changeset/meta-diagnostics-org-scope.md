---
'@objectstack/rest': patch
---

`GET /api/v1/meta/diagnostics?type=` now states the caller's organization

The cross-type spec-validation sweep behind the Studio governance directory named no
organization, so an organization's own metadata overlays were absent from it — clean tiles
rendered over a partition the sweep never read. The protocol implementation already
declares and reads `organizationId`; only the REST call site never supplied one.

The `?type=` arm now resolves the request's memoised execution context and passes
`organizationIdForMetaRead(canonicalMetaUrlType(type), ctx.tenantId)` — the same
registry-gated predicate the list, single-item, `/layers`, `/history` and `/diff` doors
already use, so read scope and write scope cannot drift: a type the registry declares
`allowOrgOverride: false` keeps reading environment-wide, and an anonymous or
organization-less caller reads exactly what it read before.

The untyped whole-registry sweep is deliberately unchanged and remains environment-wide:
it spans types with different `allowOrgOverride` while the request carries a single
`organizationId`, which cannot express a per-type scope. That gap is tracked on the card.
