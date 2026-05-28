# @objectstack/plugin-org-scoping

## 7.0.0

### Minor Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Initial release

Extracted from `@objectstack/plugin-security` (which previously gated the same logic behind a `multiTenant: true` constructor option). The split lets single-tenant deployments install plugin-security without paying for organization-scoping middleware, and lets organization-scoping be reasoned about as a self-contained protocol with its own tests.

#### Surface

- `OrgScopingPlugin` — main plugin class.
- `claimOrphanOrgRows(ql, organizationId)` — adopt NULL-org seed rows into the first organization.
- `cloneOrgSeedData(ql, organizationId)` — clone the donor org's seed rows into a freshly-created org.
- `ensureDefaultOrganization(ql)` — bind the first platform admin to a `Default Organization` (slug `default`).

#### Behavior

When registered, the plugin installs three ObjectQL middlewares:

1. Insert auto-stamp of `organization_id` from `ExecutionContext.tenantId`.
2. Post-insert pipeline on `sys_organization`: seed-replay → claim → clone.
3. Default-org bootstrap on `kernel:ready` and after every `sys_user_permission_set` insert.

It also exposes itself as the `org-scoping` service so `@objectstack/plugin-security` can detect its presence and keep wildcard `current_user.organization_id` RLS policies.
