---
"@objectstack/metadata-protocol": minor
"@objectstack/rest": minor
"@objectstack/spec": minor
---

feat(metadata-protocol)!: cross-tenant uninstall must be declared — `deletePackage` refuses a call that names neither an organization nor `allTenants` (#7780)

**This changes the contract of a destructive operation, and a caller that omits
the organization today starts getting a 400. That is the point of the change,
not a side effect of it.**

`protocol.deletePackage` selected its rows with `{ package_id }` and added an
organization predicate only when the caller supplied one. With no
`organizationId` the predicate matched **every organization's rows** — measured
during #7705 at 5 of 5 deleted, including a foreign organization's.

Nobody chose that. It fell out of a missing argument, and the two doors of
`DELETE /api/v1/packages/:id` disagreed about which semantic they were invoking:

- the direct-mount REST registrar (`packages/rest/src/package-routes.ts`) passes
  no organization and got the cross-tenant reading;
- the dispatcher twin (`packages/runtime/src/domains/packages.ts`) resolves one
  and got the org-scoped reading.

Worse, the two are indistinguishable at the call site. `resolveActiveOrganizationId`
(#4127) is entirely `catch`-wrapped, so any throw on the auth seam returns
`undefined` — an accidental org-less call and a deliberate environment-wide one
are byte-identical, and the accident silently selected the widest possible
reading of a destructive operation.

Maintainer ruling (2026-08-12), quoted unchanged:

> 跨租户卸载必须显式声明,缺省缺参永远不等于「全部租户」.

**What changes**

- `deletePackage` gains `allTenants?: boolean`, the explicit carrier for
  cross-tenant semantics.
- A call with neither `organizationId` nor `allTenants: true` is refused with
  `TENANT_SCOPE_REQUIRED` (HTTP 400) and deletes nothing. An explicit
  `allTenants: false` is treated as undeclared: it is not an affirmative request
  for cross-tenant semantics, so it cannot authorise them.
- A call supplying **both** `organizationId` and `allTenants: true` is refused
  with the same code and status. The two are contradictory, not redundant — one
  scopes to a tenant, the other clears every tenant — and both silent
  resolutions are worse than a refusal: resolving narrow-first makes
  `allTenants: true` silently inert, and resolving explicit-first ignores a named
  organization and deletes every tenant's rows, which is the original defect
  wearing a flag. Rejecting is also the only reading that stays correct when a
  request is composed from two places (a resolver supplying the org, config
  supplying the flag). The message names both offending parameters.
- The REST direct-mount door now declares `allTenants: true`. It has no
  organization to resolve (`packages/rest` carries no org plumbing at all), so of
  the two remedies the ruling allows, only declaring the intent is available
  there. Its observable behaviour is unchanged; what changed is that the width is
  now stated at the call site instead of inferred from an absent argument.

**What deliberately does NOT change**

The no-organization branch is still **not** narrowed to `organization_id IS
NULL`. #7705 proved that narrowing orphans every org-scoped row — the same
defect pointed the other way. The remedy here is explicitness, not narrowing.

**Callers that must be updated**

Any caller of `deletePackage` that omits `organizationId` and intends an
environment-wide uninstall must now pass `allTenants: true`. The refusal message
names both remedies.

Registered on the ADR-0087 migration chain (step 17,
`package-uninstall-explicit-all-tenants`) rather than exempted: a consumer really
does have to act — an uninstall that succeeded yesterday now answers 400 until it
states its tenant scope — and which scope it meant is an intent no transform can
recover, which is the same disposition `rest-requireauth-default-flip` took for
its own default flip.

<!-- adr-0087: registered package-uninstall-explicit-all-tenants -->
