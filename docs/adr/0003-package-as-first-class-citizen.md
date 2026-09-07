# ADR-0003: Package as First-Class Citizen with Versioned Releases

**Status**: Accepted — **revised by cloud ADR-0007 (2026-06-12)**: `sys_package_installation` is hereby redefined as **desired state owned by the management plane**, never read as "what is actually installed" on any runtime path. Runtime truth lives with the environment itself (env-local artifact cache for cloud-managed environments; the `LocalManifestSource` ledger in `@objectstack/cloud-connection` for self-hosted runtimes). `observed_status` / `last_reconciled_at` on the installation row are a reported projection for drift visibility, not truth. The original "installation state lives only in the control plane, environment DBs hold zero system tables" framing of ADR-0002/0003 is superseded to that extent — driven by the hard constraint that environments must boot and serve with the cloud down.
**Date**: 2026-04-20
**Deciders**: ObjectStack Protocol Architects
**Supersedes**: The flat `sys_package_installation (package_id + version string)` model introduced alongside ADR-0002
**Consumers**: `@objectstack/spec/cloud`, `@objectstack/service-tenant`, `@objectstack/metadata`, future `service-marketplace`, `service-solution-history`, `service-subscription`

---

## Context

ADR-0002 established the Control Plane / Data Plane split and introduced `sys_package_installation` to track which packages are installed in each environment. That model stores a `package_id` (reverse-domain string) and a `version` (semver string) on the installation row.

Operating this design reveals four structural problems:

1. **Packages have no identity of their own.** There is no `sys_package` row. The platform cannot answer "what packages exist?", "who published them?", or "what is the latest stable version?" without scanning installation records.

2. **Versions are strings, not references.** A version like `"1.2.3"` carries no payload. The metadata objects, views, flows, and migrations that constitute that release live outside the model — there is no atomic snapshot to deploy, validate, or roll back.

3. **Metadata ownership is wrong.** `sys_metadata` currently carries `env_id` to scope schema definitions. But a CRM object definition (`account`, `contact`) belongs to *a specific package version*, not to an environment. Environments only need to record *which version is active* — they should not own the schema.

4. **Upgrade and rollback are not atomic.** "Upgrade env from v1.2.3 to v1.3.0" should be a single pointer swap (`package_version_id`). With the string model it degenerates into multi-row writes with no transactional boundary.

Meanwhile, every mature low-code platform treats packages/solutions as first-class versioned artifacts:

| Platform | Package | Version artifact | Install record |
|---|---|---|---|
| Salesforce | Unlocked Package (`0Ho…`) | Package Version (`04t…`) | Subscriber org row |
| Power Platform | Solution | Solution Version | Solution in Environment |
| ServiceNow | Application | App Version | Installed Application |
| npm / pip / cargo | Package | Published version tarball | `node_modules` / venv |

The common invariant: **a published version is an immutable snapshot**. Installing means pointing an environment at a snapshot; upgrading means pointing at a newer snapshot.

---

## Decision

We introduce a three-layer package model in the Control Plane:

```
Control Plane DB
│
├── sys_package               — Package identity (one row per logical package)
├── sys_package_version       — Immutable release snapshot (one row per published version)
└── sys_package_installation  — Environment ↔ version pairing (replaces old install row)
```

`sys_metadata` gains a `package_version_id` foreign key to express that a metadata record *belongs to a package version*, not to an environment directly.

### sys_package — Package Identity

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Stable identifier |
| `manifest_id` | text UNIQUE | Reverse-domain e.g. `com.acme.crm` |
| `owner_org_id` | text | Organization that publishes this package |
| `display_name` | text | Human label |
| `description` | text | Short description |
| `visibility` | enum | `private` / `org` / `marketplace` |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### sys_package_version — Immutable Release

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Stable, never reused |
| `package_id` | FK → sys_package | |
| `version` | text | semver e.g. `1.2.3` |
| `status` | enum | `draft` / `published` / `deprecated` |
| `release_notes` | text | Optional changelog |
| `manifest_json` | JSON | Full package manifest snapshot at publish time |
| `checksum` | text | SHA-256 of `manifest_json` for integrity checks |
| `min_platform_version` | text | Minimum ObjectStack version required |
| `published_at` | datetime | Null while `draft` |
| `published_by` | text | User ID |
| `created_at` | datetime | |

Unique constraint: `(package_id, version)`.

Once `status = 'published'`, `manifest_json` and `checksum` are **immutable**.

### sys_package_installation — Environment ↔ Version Pairing

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `environment_id` | FK → sys_environment | |
| `package_version_id` | FK → sys_package_version | **replaces** `package_id + version` string pair |
| `status` | enum | `installed` / `installing` / `upgrading` / `disabled` / `error` |
| `enabled` | boolean | Whether metadata is loaded into this env |
| `settings` | JSON | Per-installation config overrides |
| `installed_at` | datetime | |
| `installed_by` | text | |
| `updated_at` | datetime | |
| `error_message` | text | Set when `status = 'error'` |

Unique constraint: `(environment_id, package_id)` — derived via `package_version_id.package_id`. Only one version of a given package may be active per environment at a time.

**Upgrade** = UPDATE `package_version_id` to new version's UUID. The old version row remains intact (audit trail). `upgradeHistory` is removed from the installation row — the history is implicit in the sequence of `updated_at` snapshots and an optional `sys_package_installation_history` log table.

### sys_metadata — Ownership Clarification

`sys_metadata` gains one new optional foreign key:

```
package_version_id  FK → sys_package_version   nullable
```

Effective query for "what metadata is active in environment E?":

```sql
-- 1. All package-owned metadata from installed versions
SELECT m.*
FROM sys_metadata m
JOIN sys_package_installation i ON i.package_version_id = m.package_version_id
WHERE i.environment_id = :env_id
  AND i.enabled = true

UNION ALL

-- 2. Environment-level overrides / customizations
SELECT m.*
FROM sys_metadata m
WHERE m.env_id = :env_id

-- Result: overlay env overrides on top of package metadata (same type+name → env wins)
```

Three ownership tiers:

| `package_version_id` | `env_id` | Meaning |
|---|---|---|
| set | NULL | Belongs to a package version (deployed with the package) |
| NULL | set | Environment-level override or custom metadata |
| NULL | NULL | Platform-built-in / global (e.g. `sys_user` object) |

---

## Migration from the Old Model

1. **Create `sys_package` and `sys_package_version` tables** (additive, non-breaking).
2. **Backfill**: For each distinct `(package_id, version)` string pair found in the old `sys_package_installation`, create one `sys_package` row and one `sys_package_version` row. The `manifest_json` field can be populated lazily (null until the package is re-published through the new flow).
3. **Add `package_version_id` column** to `sys_package_installation`. Populate from the backfill mapping.
4. **Drop** old `package_id` (string) and `version` (string) columns from `sys_package_installation` — in v5.0 after a deprecation window.
5. **Add `package_version_id` column** to `sys_metadata`. Populate for any metadata rows that were installed by a known package version.

The migration is non-destructive and idempotent. Steps 1–4 ship in v4.x as an opt-in; step 4 (column drop) is a v5.0 hard cut.

---

## Consequences

### Positive

- **Package identity is a first-class query.** `GET /cloud/packages` returns the catalog. `GET /cloud/packages/:id/versions` lists all releases.
- **Atomic deploys and rollbacks.** Upgrading or rolling back is a single `UPDATE package_version_id`. No row-level copy jobs.
- **Schema ownership is unambiguous.** An `account` object lives in `sys_metadata` with `package_version_id = <crm-1.2.3>`. It does not belong to any environment — environments only install the version.
- **Marketplace / App Store foundation.** `sys_package.visibility = 'marketplace'` is the hook for the public registry (ADR-0004, future).
- **Integrity guarantees.** `manifest_json + checksum` on a published version means the platform can verify nothing has been tampered with at install time.
- **Clean upgrade audit trail.** The history of `package_version_id` changes on an installation row (plus an optional history table) is authoritative.

### Negative / Trade-offs

- **More join hops** for the effective-schema query (env → installations → versions → metadata). Mitigated by the metadata cache layer in `MetadataManager`.
- **Backfill cost** for existing deployments — `manifest_json` is not available for legacy string-version installations. Lazy population is acceptable for most cases.
- **Draft versions** must not be accidentally installed in production. Enforcement: install API rejects `status != 'published'` unless `allowDraft = true` flag is set (dev/sandbox envs only).
- **One version per package per environment** is a hard constraint. Side-loaded / multi-version installs are explicitly out of scope (same trade-off as npm's `peerDependencies` model).

### Neutral

- No change to `sys_environment`, `sys_environment_member`, or `sys_database_credential`.
- No change to the business data in environment DBs.
- No change to `env_id = NULL` meaning "platform-global" for metadata without a package owner.
- `better-auth` session shape is unchanged.

---

## Alternatives Considered

1. **Keep `package_id + version` strings, add a separate version catalog table but don't FK it.** Rejected — without a hard FK the catalog can drift from installations, defeating the integrity argument.
2. **Embed the full manifest in each installation row.** Rejected — N environments × M packages = N×M copies of the same JSON. The version table is the single source of truth.
3. **Move package versioning entirely to the filesystem / Git.** Rejected — query-ability (list installed packages, filter by status, detect conflicts) requires a database-backed model.
4. **Allow multiple active versions of the same package per environment.** Rejected — conflict resolution between overlapping metadata definitions is intractable. One version per package per env, same as every comparable platform.

---

## References

- `packages/spec/src/cloud/environment-package.zod.ts` — current installation schema (to be updated)
- `packages/services/service-tenant/src/objects/sys-package-installation.object.ts` — DB object (to be updated)
  *(Path note, 2026-09: historical and deliberately unlinked — the `packages/services/service-tenant/` package left this repository with the control-plane split to `objectstack-ai/cloud` (`473fce590`, 2026-05-21).)*
- ADR-0002: `docs/adr/0002-environment-database-isolation.md` — Control Plane / Data Plane split
- Salesforce Unlocked Packages: <https://developer.salesforce.com/docs/atlas.en-us.pkg2_dev.meta/pkg2_dev/>
- Power Platform Solution Layers: <https://learn.microsoft.com/power-platform/alm/solution-layers-alm>
- ServiceNow Application Management: <https://docs.servicenow.com/bundle/washingtondc-application-development/page/build/applications/concept/application-management.html>
