# @objectstack/plugin-security

> Security plugin for ObjectStack — RBAC, Row-Level Security (RLS), and Field-Level Masking enforced transparently through the ObjectQL middleware chain.

[![npm](https://img.shields.io/npm/v/@objectstack/plugin-security.svg)](https://www.npmjs.com/package/@objectstack/plugin-security)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../../LICENSING.md)

## Overview

`plugin-security` hooks into the ObjectQL pipeline and applies authorization on every read and write:

1. **Resolve permission sets** — expand the user's positions and direct grants against `SysPermissionSet` metadata.
2. **Check object CRUD** — `allowRead`, `allowCreate`, `allowEdit`, `allowDelete`.
3. **Inject RLS** — compile row-level policy expressions into query filters.
4. **Mask fields** — remove non-readable fields from results; flag non-editable fields on writes.

System-context operations bypass checks so internal jobs, migrations, and seed scripts work unobstructed.

## Installation

```bash
pnpm add @objectstack/plugin-security
```

## Quick Start

```typescript
import { ObjectKernel } from '@objectstack/core';
import { SecurityPlugin } from '@objectstack/plugin-security';

const kernel = new ObjectKernel();
kernel.use(new SecurityPlugin());
await kernel.bootstrap();
```

### Multi-tenant vs single-tenant

`SecurityPlugin` is single-tenant by default. It enforces RBAC, owner-based RLS, and Field-Level Security regardless of mode.

For **multi-tenant** (logical row-level Organization scoping) install [`@objectstack/plugin-org-scoping`](../plugin-org-scoping/README.md) *before* SecurityPlugin:

```typescript
import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';

await kernel.use(new OrgScopingPlugin());  // MUST be BEFORE SecurityPlugin
await kernel.use(new SecurityPlugin());
```

SecurityPlugin resolves the tenancy **posture** (`single` | `group` | `isolated`) once at start time — preferring the `tenancy` service, and falling back to probing `getService('org-scoping')` (present ⇒ the historical `isolated` posture). Two consequences:

- **Tenant isolation is not an RLS policy.** Since ADR-0095 D1 the organization wall is **Layer 0** (`tenant-layer.ts`): an independent filter AND-composed ahead of business RLS, so a business-RLS change can never weaken it (W1) and the `viewAllRecords` / `modifyAllRecords` superuser bypass can never cross it (W2 — crossing takes a true `PLATFORM_ADMIN`). Under the `single` posture Layer 0 is inert. Accordingly the default `member_default` / `viewer_readonly` sets ship **no** wildcard `tenant_isolation` policy: `member_default` carries the owner-scoped `owner_only_writes` / `owner_only_deletes` plus per-object `_self` carve-outs on the better-auth identity tables, and `viewer_readonly` carries the `_self` carve-outs only.
- **The platform's own tenant-scoped RLS policies are still stripped when no wall is enforced** (`single`), so single-tenant deployments aren't filtered to zero rows and don't pay the field-existence safety net on every find — e.g. `organization_admin`'s `sys_member_org` / `sys_invitation_org` / `sys_team_org`, and the `sys_organization_self` carve-out. The strip is by **provenance**, not by pattern-matching the predicate: an app-authored tenant policy is never stripped — it reaches the compiler and fails closed there, with a one-time operator warning (ADR-0105 D3).

`organization_id` auto-injection on insert is provided by OrgScopingPlugin; `owner_id` auto-injection always runs in SecurityPlugin regardless.

In CLI / dev-server mode the `OS_MULTI_ORG_ENABLED` environment variable (default `false`) toggles whether the runtime registers `OrgScopingPlugin` alongside `SecurityPlugin`. Set `OS_MULTI_ORG_ENABLED=true` before `objectstack serve` / `pnpm dev` to enable.

## Key Exports

| Export | Kind | Description |
|:---|:---|:---|
| `SecurityPlugin` | class | Kernel plugin that installs the four-step security chain. |
| `PermissionEvaluator` | class | Evaluates object-level CRUD permissions across the held permission sets (most-permissive merge). |
| `RLSCompiler` | class | Compiles RLS expressions into ObjectQL filter AST. |
| `FieldMasker` | class | Strips non-readable fields and identifies non-editable ones. |
| `SysPosition`, `SysPermissionSet` | objects | Metadata objects registered by the plugin. |

## System objects

The plugin contributes these system objects to the kernel:

| Object | Purpose |
|:---|:---|
| `sys_position` | Position (岗位) definitions — the flat permission-set distribution layer (ADR-0090 D3). |
| `sys_permission_set` | Bundles object and field permissions; can include RLS expressions and a delegated-admin `admin_scope` (ADR-0090 D12). |

Assignment tables (position ↔ user, position ↔ permission_set, user ↔ permission_set) are registered alongside and governed by the delegated-admin and audience-anchor gates.

## RLS expression language

RLS policies are authored in the same expression language as object validations. Example:

```json
{
  "object": "project_task",
  "read": "owner_id = $user.id OR team_id in $user.team_ids"
}
```

Compilation output is a filter AST merged into every query's `where` clause, so drivers see it as a normal filter.

## When to use

- ✅ Any multi-user deployment.
- ✅ Enforcing tenant isolation (combine with [`@objectstack/service-tenant`](../../services/service-tenant)).

## When not to use

- ❌ Trusted single-user CLI scripts — disable per-request via the system context.

## Related Packages

- [`@objectstack/plugin-auth`](../plugin-auth) — authentication and user resolution.
- [`@objectstack/plugin-audit`](../plugin-audit) — pairs with security for full compliance trails.
- [`@objectstack/objectql`](../../objectql) — query engine.

## Links

- 📖 Docs: <https://objectstack.ai/docs>
- 📚 API Reference: <https://objectstack.ai/docs/references/security>

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).
