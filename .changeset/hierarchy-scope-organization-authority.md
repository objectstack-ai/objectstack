---
"@objectstack/spec": major
---

fix(spec)!: `HierarchyScopeContext.organizationId` is the authoritative tenancy field, and it is now required (#5858)

`HierarchyScopeContext` declared `organizationId?: string | null` and
`tenantId?: string | null` side by side with no doc saying which one carries the
caller's active organization. That silence had a measured cost (#5852): the
single in-repo producer (`@objectstack/plugin-sharing`) filled `organizationId`
from a `SharingExecutionContext` whose only tenancy member is `tenantId`, so the
read was structurally always `null`, while the real consumer — the enterprise
`hierarchy-scope-resolver` — reads `organizationId`, saw `null`, and skipped
tenant isolation. Both ends were individually contract-compliant; the pair was a
reachable cross-organization read.

The contract now says which field is authoritative, and enforces it structurally
rather than in prose:

- **`organizationId` is the authority** — the caller's active organization,
  `null` = platform/unscoped, the same meaning `EvalUser.organizationId`
  already carries. This is the repo's settled name for the concept, not a new
  one: #3280 blessed `organizationId` as the developer-facing name for the
  caller's active org (matching the `organization_id` column and
  `current_user.organizationId` in RLS), #3290 removed the `session.tenantId`
  alias in v11, and `scripts/check-org-identifier.mjs` gates it in CI.
- **It is REQUIRED** — `organizationId: string | null`, never omitted. A
  producer that forgets to state the caller's org now fails to compile instead
  of handing every resolver an `undefined` it will read as "unscoped". Stating
  "no org" is still allowed, but it must be stated: `null` is a value, not an
  omission.
- **`tenantId` is retained as a deprecated alias**, not removed. It stays the
  generic driver-layer tenancy knob (a database-per-tenant kernel legitimately
  puts an *environment* id there), and its doc now says a resolver must not
  depend on it alone or use it as a stand-in for a `null` `organizationId`.
  Its removal is a separate, deliberate retirement.
- **`IHierarchyScopeResolver.resolveOwnerIds` documents the fail-closed
  obligation**: when `organizationId` is `null`, an implementation must not
  build the owner set as though no tenancy constraint applied — "no org" is
  never "every org". Return owner-only (or throw, which the sharing layer
  treats the same way); never widen.

**Migration.** Breaking for *producers* of the context only — implementers of
`IHierarchyScopeResolver` are unaffected (a required property is strictly easier
to consume). A producer that omitted the key adds `organizationId: <the caller's
active org, or null>`; a producer that was passing the org under `tenantId` must
move it, which is the bug this closes rather than a rename to absorb. The only
in-repo producer already supplied the key, so nothing in this repo changed
shape.
