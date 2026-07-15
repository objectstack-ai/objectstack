---
'@objectstack/spec': minor
---

feat(spec)!: remove `tenancy.strategy` + `tenancy.crossTenantAccess`; tenancy block is now strict (#2763)

> ⚠️ RELEASE NOTE — breaking by strict semver, shipped as `minor` per the
> launch-window policy (owner decision on PR #2962): the fields had zero
> consumers, behavior is unchanged, and the parse error carries the
> migration. Fold into the v15 release page's "What's new in 15.x" section
> when versioning.

BREAKING CHANGE: `TenancyConfigSchema` drops its two zero-consumer fields, and
the `tenancy` block is now `.strict()` — an unknown key is a loud parse error
with tombstone guidance instead of a silent zod strip (#1535; precedent
ADR-0056 D8 "compliance-grade config must never merely look live", ADR-0049
enforce-or-remove).

The platform has exactly two tenancy modes, and neither needs object-level
strategy config: database-per-tenant isolation is an environment/deployment
choice (each environment carries its own database URL), and shared-database
row isolation is `tenancy.enabled` + `tenancy.tenantField` (both stay, both
live: sql-driver row scoping, security-plugin org scoping). Cross-tenant
visibility is governed by sharing rules / OWD (ADR-0056),
`externalSharingModel` (ADR-0090 D11), and the object access posture — never
by a blanket boolean.

Migration (delete the keys; nothing read them, so behavior is unchanged):

- FROM `tenancy: { enabled: false, strategy: 'shared' }` → TO `tenancy: { enabled: false }`
- FROM `tenancy: { enabled: true, strategy: '...', tenantField: 'x', crossTenantAccess: false }` → TO `tenancy: { enabled: true, tenantField: 'x' }`
- Wanted per-tenant databases? Deploy per environment (EnvironmentKernelFactory) — not object metadata.
- Wanted cross-tenant visibility? Use sharing rules / OWD or `externalSharingModel`.

The compile-time authorWarn for these fields (#2750) and their liveness-ledger
entries are retired with the removal; the schema itself now carries the
prescription.
