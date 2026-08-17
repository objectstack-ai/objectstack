# ADR-0002: Environment-Per-Database Isolation

**Status**: Accepted
**Date**: 2026-04-19
**Deciders**: ObjectStack Protocol Architects
**Supersedes**: The v3.4/v4.0 "per-organization database" tenant model
**Consumers**: `@objectstack/service-tenant`, `@objectstack/spec/cloud`, future `service-subscription`, `service-quota`, `service-audit-log`, `service-dlp-policy`, `service-solution-history`

---

## Context

The v3.4 / v4.0 multi-tenant model in `@objectstack/service-tenant` provisions **one physical database per organization**, registered in `sys_tenant_database`. Logical separation between *environments* (dev / test / prod / sandbox) is achieved by an `env_id` column carried on every row in every data-plane table.

Operating this model in production surfaced five classes of recurring problems:

1. **Leaky logical isolation.** Every query must carry `WHERE env_id = ?`. A single missing predicate in a hand-written query, a migration, a background job, or a badly-written skill can corrupt production from a developer shell.
2. **Coupled schema evolution.** A Solution can't upgrade its schema in `dev` without affecting `prod` — the tables are the same physical tables. This blocks blue/green schema rollouts, destructive migrations, and safe rollback.
3. **Complex backup / DR.** Backing up or restoring just `prod` requires per-row filtering during dump/restore. Point-in-time recovery of one environment leaks into others.
4. **Difficult Solution publishing.** "Promote Solution X from dev to prod" degenerates into row-level copy jobs with `env_id` rewriting — slow, fragile, and nearly impossible to make atomic.
5. **No physical boundary for security / compliance.** Per-environment encryption keys, IP allow-lists, retention policies, and audit isolation all require a per-environment DB to be credible.

Meanwhile, the ecosystem has moved on:

- **Turso / libSQL**, **Neon**, **Supabase branches**, **PlanetScale branches**, and **Cloudflare D1** all make "a database per environment" a near-free operation (milliseconds to provision, cents per month to idle).
- **Power Platform**, **Salesforce**, and **ServiceNow** all expose environments as first-class primitives backed by isolated storage.
- **Kubernetes namespaces** are the pattern developers reach for; the data layer should match.

## Decision

We upgrade the multi-tenant architecture from **per-organization database** to **per-environment database**, with a hard split between Control Plane and Data Plane:

### Control Plane (shared, single database)

Registers environments and how to reach them — **never** stores business data:

| Table                       | Purpose                                                                          |
|-----------------------------|----------------------------------------------------------------------------------|
| `sys_environment`           | One row per environment — `(organization_id, slug)` UNIQUE. **Includes** physical DB addressing fields (`database_url`, `database_driver`, `storage_limit_mb`, `provisioned_at`). |
| `sys_database_credential`   | Rotatable encrypted secrets (N:1 with `sys_environment`)                         |
| `sys_environment_member`    | Per-environment RBAC (`(environment_id, user_id)` UNIQUE)                        |
| `sys_package_installation`  | Which packages are installed in which environment (includes `environment_id`)     |
| `sys_metadata`              | Schema metadata for all environments (includes `organization_id` + `env_id`)     |

> **Design note:** `sys_environment_database` has been merged into `sys_environment`.
> Physical DB addressing is a 1:1 relationship — a dedicated table was unnecessary.
> This reduces joins and simplifies the provisioning flow.

> **Design note:** `sys_metadata` and `sys_package_installation` live in the **Control Plane**,
> not in environment DBs. Metadata is environment-scoped via `env_id` (NULL = platform-global).
> This follows the Power Apps model where the management plane tracks all schema and packages.

### Data Plane (one database per environment)

Each environment owns its own physical database containing:

- All business objects — `account`, `contact`, user tables, …
- **Zero** system tables or `environment_id` columns. The environment is **implicit** in the connection.

### Session → Routing

`better-auth` sessions carry a single `active_environment_id`. The tenant router resolves:

```
session.active_environment_id
    → sys_environment (url, driver, region — single row lookup)
    → sys_database_credential (active secret, decrypted)
    → data-plane driver
```

Switching environments ⇒ swapping DB connections. There is no in-process filter that can be forgotten.

### Provisioning API

`EnvironmentProvisioningService` (new) exposes:

- `provisionOrganization(req)` — atomically creates the org's **default** environment and its physical DB (replaces `provisionTenant`).
- `provisionEnvironment(req)` — allocates any subsequent `dev` / `test` / `sandbox` / `preview` environment, each with its own DB and credential row. DB addressing fields are written directly onto the `sys_environment` row.
- `rotateCredential(environmentId, plaintext)` — issues a new `active` credential and revokes the previous one.

Physical-DB allocation is delegated to pluggable `EnvironmentDatabaseAdapter` implementations (initially `turso`; `libsql` / `sqlite` / `postgres` drop in without core changes).

### Deprecation & Migration

- **v4.x** keeps `sys_tenant_database` registered as a deprecation shim (TSDoc `@deprecated`, runtime log warning). The new control-plane objects ship alongside it, additive, non-breaking.
- `migrations/v4-to-v5-env-migration.ts` ships in v4.x as a **skeleton** (stable public API) and is executed during the v5.0 upgrade.
- **v5.0** removes `sys_tenant_database` and its reader code entirely.

The migration is **non-destructive** and **idempotent**: each legacy org's database is reused as its new `prod` environment DB — no data movement, no cutover window.

## Consequences

### Positive

- **Hard isolation.** Prod and dev are separate databases; no `WHERE` clause can be forgotten.
- **Independent schema evolution.** Solutions upgrade their schema in `dev`, validate, then promote via a single DB-level backup/restore into `prod`.
- **Trivial backup / DR.** Per-environment backup = native DB backup. PITR stays within one environment.
- **First-class Solution publishing.** "Publish" becomes a schema + metadata export from `dev` and an idempotent apply into `prod`, operating on cleanly-scoped DBs.
- **Per-environment security posture.** Each environment owns its own credential, its own network ACL, its own quotas, its own retention.
- **Pluggable backend.** Driver-agnostic — new backends register an `EnvironmentDatabaseAdapter` without core changes.
- **Future-proof.** Naturally slots in quotas (`sys_quota`), subscriptions (`sys_subscription`), audit (`sys_audit_log`), DLP (`sys_dlp_policy`), and solution history (`sys_solution_history`) as subsequent PRs.

### Negative / Trade-offs

- **More databases to operate.** Every org now has ≥1 DB; heavy users of `sandbox` / `preview` environments may have 5–20. Mitigated by Turso/libSQL free-tier economics and lazy provisioning.
- **Cross-environment reporting** (e.g. "how many leads across all of Acme's envs?") becomes an explicit federation query. Acceptable — such queries are rare and better expressed at the BI layer.
- **Cold starts.** A dormant environment may need to be resumed on first access. Mitigated by the router's TTL cache and the adapter's warm-up hook.
- **Connection sprawl.** A node handling many environments holds N connections. Mitigated by an LRU connection pool with per-env TTL (already present in the v3.4 router).
- **Irrevocable breaking change at v5.0.** v4.x ships the shim and migration; v5.0 removes legacy code. Customers must run the migration before upgrading.

### Neutral

- No change to Zod-first, `.describe()` on every field, `sys_` prefix invariants.
- No change to the public `ObjectKernel` / plugin lifecycle.
- No change to `better-auth` session shape beyond renaming `active_organization_id` → `active_environment_id` (v5.0).

## Alternatives Considered

1. **Stay with per-org DB + `env_id` column.** Rejected — the failure modes above are structural, not implementation bugs.
2. **Schema-per-environment inside one DB.** Works for Postgres but not Turso/libSQL/SQLite, and defeats the backup/DR argument. Rejected.
3. **Row-level security via Postgres RLS.** Strengthens the `env_id` approach but still leaves schema evolution coupled and DR complex. Rejected.
4. **One global DB + tenant column.** Was never on the table — already discarded in the v3.4-era "ADR-0001", a pre-registry document this repository has never contained and not the unrelated metadata-service record that held the number here ([tombstone](./0001-withdrawn-metadata-service-architecture.md#what-adr-0002-actually-cites)).

## References

- `packages/spec/src/cloud/environment.zod.ts` — protocol schemas
- `packages/services/service-tenant/src/objects/sys-environment.object.ts` — merged control-plane environment object (includes DB addressing)
- `packages/services/service-tenant/src/environment-provisioning.ts` — provisioning service
- `packages/services/service-tenant/migrations/v4-to-v5-env-migration.ts` — migration skeleton
- Power Platform environments: <https://learn.microsoft.com/power-platform/admin/environments-overview>
- Salesforce sandboxes: <https://help.salesforce.com/s/articleView?id=data.sandboxes.htm>
- Turso multi-DB pricing: <https://turso.tech/pricing>
