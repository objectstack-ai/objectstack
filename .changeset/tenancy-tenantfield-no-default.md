---
"@objectstack/spec": minor
---

fix(spec)!: `tenancy.tenantField` no longer defaults to `'tenant_id'` — an undeclared tenant column stays `undefined` and the driver's `organization_id` fallback is the single source of truth (#5315)

`TenancyConfigSchema.tenantField` carried `.default('tenant_id')`, so parsing
`tenancy: { enabled: true }` materialized `tenantField: 'tenant_id'` onto every
object that never asked for it. The platform's tenant column is
`organization_id` — the one the kernel injects, the one `rls.zod.ts`'s
`tenantPolicy()` defaults to, and the one the SQL driver actually scopes by.
The default was therefore a value **no consumer could use**: `computeTenantField`
in `driver-sql` honours a declared `tenantField` only when the object really has
that column, so the materialized `'tenant_id'` sent it looking for a column that
does not exist, the branch was skipped, and the fallback to `organization_id`
produced the right answer anyway. A declaration nobody reads (ADR-0078), spelling
a word the vocabulary rejects (ADR-0120 §Terminology fixes the authorable term at
`organization`, refusing `tenant`/`org`).

**What changes for an author**

| | before | after |
|:---|:---|:---|
| `tenancy: { enabled: true }` (parsed) | `{ enabled: true, tenantField: 'tenant_id' }` | `{ enabled: true }` |
| effective tenant column | `organization_id` | `organization_id` (unchanged) |
| `tenancy: { enabled: true, tenantField: 'workspace_id' }` | honoured when the column exists | unchanged |

**The effective tenant column does not move.** That equivalence is pinned end to
end — parse through `ObjectSchema` and then resolve through the driver — by
`#5315 undeclared tenantField resolves to organization_id` in
`packages/drivers/driver-sql/src/sql-driver-tenant-scope.test.ts`.

**Type-level**: `TenancyConfig['tenantField']` widens from `string` to
`string | undefined`. Code that read the parsed value as a guaranteed string must
handle `undefined` — the correct fallback is `'organization_id'`, matching
`computeTenantField` and `tenantPolicy()`. No such reader existed in this repo,
`objectui`, or `cloud`: both real consumers already guarded (`driver-sql`
`computeTenantField` truthiness-checks it; `@objectstack/lint`
`authoredTenantColumn` falls back to `'organization_id'`).

Declaring `tenantField` explicitly is unchanged and still honoured — this only
stops the spec from inventing a value the author never wrote.
