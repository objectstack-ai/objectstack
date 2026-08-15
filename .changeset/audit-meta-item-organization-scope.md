---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

fix(metadata-protocol): scope the metadata audit read to the caller's organization (#8747)

`ObjectStackProtocolImplementation.auditMetaItem` declared
`organizationId?: string | null` and never read it. The comment directly above
its query described the filter it would have built — "include rows for the
specific org AND env-wide (`organization_id IS NULL`) rows" — while the `where`
was exactly `{ type, name }`. The parameter was dead on the caller side too:
`GET /api/v1/meta/:type/:name/audit` never passed one.

The consequence was a cross-tenant disclosure, measured rather than inferred:
three saves of one view name under two organizations and env-wide, then one
`auditMetaItem({ type, name })` read, returned all three organizations' rows —
and with each row its `actor`, `note`, `lock_state`, `code`, `operation`,
`source` and `request_id`. Nothing compensated lower down. The driver's tenant
wall never engaged, because it is armed only from an execution context this
read did not pass; the security plugin's Layer 0 never engaged, because the
middleware short-circuits on a principal-less call long before the field gate
that would have carried it; and no tenancy posture would have supplied the
scope either. The route carries no capability gate — unlike its `PUT` twin,
which gates on `manage_metadata` — so the reachable cohort was any
authenticated principal of any tenant, on the published `meta.getAudit` SDK
surface.

The query now builds the described filter: rows for the caller's organization
plus env-wide (`organization_id IS NULL`) rows, and nothing else. The env-wide
limb is load-bearing rather than defensive — the REST `PUT /meta/:type/:name`
door passes no organization, so every row it writes is stamped
`organization_id: null`, and an equality-only filter would have blanked the
audit tab on those deployments instead of scoping it. A read that resolves no
organization is fail-closed onto the env-wide rows, symmetric with what an
org-less write produces, so omitting the parameter is no longer a skeleton key.

The REST route supplies the organization from the execution context it already
resolves for 40-plus handlers, adding no new organization-resolution plumbing
to `packages/rest`. The same call also stopped passing `environmentId`, which
the request type never declared and the method body never read; environment
scoping is unaffected, since it comes from which protocol instance is resolved
rather than from the request payload.

Behaviour change worth stating plainly: a caller that previously saw another
tenant's metadata audit rows for a same-named item no longer sees them. Own-org
and env-wide rows are unchanged.
