---
"@objectstack/spec": minor
"@objectstack/plugin-audit": minor
"@objectstack/platform-objects": patch
---

feat(spec): stamp-only `tenancy.organizationField` — audit rows can follow the record's organization on objects that must stay unwalled (#8778, closes the #8707 remainder)

The platform had one answer to "what is this object WALLED by"
(`tenancy.tenantField`) and no answer to "which column says who this row is
ABOUT". For ordinary objects the two coincide; for credential tables they
deliberately do not — `sys_api_key` records the organization a key
authenticates into under `active_organization_id` precisely so the credential
table is not org-walled (#8287). #8777's schema-resolved audit stamping could
therefore reach every shipped object except the one that motivated it, and
revocation rows on `sys_api_key` kept stamping the revoker's organization.

`TenancyConfigSchema` now accepts an optional `organizationField` — a
READ-NEUTRAL, STAMP-ONLY declaration (maintainer-ruled option A on #8778):

- The audit writer's `resolveRecordOrganizationField` consults it first, ahead
  of the ADR-0066 `enabled: false` opt-out — an author declaring it on an
  unwalled object is stating exactly that the audit trail should follow the
  record's own organization even though no wall does. It is honoured only when
  the object really has the field (the #5315 guard `tenantField` carries).
- No read path reads it: `applyTenantScope`, `injectTenantOnInsert`,
  `computeTenantLayer0Filter` and `resolveInjectedSystemColumns` are all
  measured blind to it, and that read-neutrality is pinned by tests beside
  each. Declaring it never walls an object and never hides rows.
- ⛔ Scope pin from the ruling: this is ONE stamp-only key, not the opening
  move of a general field-roles mechanism. A consumer other than audit
  stamping needs its own ruling before reading it.

`sys_api_key` now declares
`tenancy: { enabled: false, organizationField: 'active_organization_id' }`,
so revoking another user's key from a different active organization lands the
audit row behind the wall of the KEY's organization — where the tenant admin
who can act on it reads it. The `enabled: false` is measured
behavior-identical to the previous absent block for this object on every read
path (injection bails on `managedBy: 'better-auth'` first; the SQL driver's
tenant field resolves null either way; Layer 0 is exempt either way; the
memory/mongo boot guards count only an explicit `enabled: true`).
