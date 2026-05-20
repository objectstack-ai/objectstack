# ADR-0006: Three-Layer Tenancy — Organization, Project, Environment

**Status**: Accepted (v2)
**Date**: 2026-05-20 (v1) / 2026-05-20 (v2 — same day revision)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: ADR-0002 (Environment-Per-Database Isolation), ADR-0003 (Package as First-Class Citizen), ADR-0005 (Metadata Customization Overlay)
**Consumers**: `@objectstack/service-tenant`, `@objectstack/service-cloud`, `@objectstack/spec/cloud`, `apps/cloud`, `apps/objectos`, the Console `cloud_control` app, the Marketplace publisher CLI

> **v2 revision note** — v1 modelled the layers as a strict tree
> (`Org → Project → Environment`), which forced every consumer to
> create a Project even when they only wanted to install a Marketplace
> package. v2 promotes Project and Environment to **siblings under
> Organization** with an optional `sys_deployment` join, matching the
> Salesforce / ServiceNow / Shopify model where the runtime container
> is the unit users pay for and Project is reserved for developers
> who customize.

---

## Context

After ADR-0002 introduced per-environment databases and ADR-0003 made
`sys_package` a first-class artifact, the runtime ended up with a
**single conflated layer** (`sys_project`) that tries to serve two
distinct concerns:

1. **Authoring** — the human-owned workspace where metadata,
   customizations, branches, reviews, and releases live. Owned by
   developers / power users. There is **0 or 1** of these per logical
   product.
2. **Runtime** — the host that actually serves a hostname. There are
   **1..N** of these per product (`dev`, `staging`, `prod`), each with
   its own DNS hostname, database URL, quota envelope, and rollout
   state.

The current schema collapses both into `sys_project`. Concrete pain:

- A consumer who installs ACME CRM from the Marketplace is forced to
  pick a "Project" name they will never use again.
- `sys_package_installation.project_id` cannot express "pin
  `crm@1.4.2` to prod and `crm@1.5.0-beta` to staging".
- The Create Project form forces driver / storage decisions before
  the user has even committed to using the platform (the `min=max=0`
  storage limit field in the migrated Console is a direct symptom).

Benchmarking again, with v2's eyes — note who has a Project at all:

| Platform | Runtime container (sibling of Org) | Authoring workspace |
|----|----|----|
| Salesforce | **Org** (Sandbox / Production / Scratch) | DX Project (devs only) |
| ServiceNow | **Instance** | Application (devs only) |
| Shopify | **Store** | n/a (no first-party authoring) |
| Notion | **Workspace** | n/a |
| Vercel | Deployment (under Project) | **Project** (mandatory — assumes git repo) |
| **ObjectStack today** | sys_project | sys_project ← *same row* |

Four of five benchmarks make the runtime container the primary
creatable unit. Vercel is the outlier because it presumes every user
has a git repository. ObjectStack does not — we have first-party
starter packages, no-code consumers, and a Marketplace.

---

## Decision

Adopt a **three-layer model with Project and Environment as siblings**
under Organization, joined by an optional `sys_deployment` row:

```
Organization (cloud tenant — billing, members, SSO)
  ├── Project (0..N — optional authoring scope)
  │     └── Revision  ← Branch ← Member
  ├── Environment (1..N — runtime container, primary user-facing unit)
  │     └── Installation (M:N → PackageVersion)
  └── Deployment (M:N join: Project Revision × Environment, only when a
                  Project is deployed; absent for pure-consumer envs)
```

Two user personas, two paths:

| Persona | What they create first | Sees in nav |
|----|----|----|
| **Consumer** (no-code) | Environment + Installations from Marketplace | `Environments`, `Marketplace` |
| **Builder** (developer) | Project (with branches/revisions) → Deploys to Environment(s) | `Environments`, `Projects` (under "Developer" sub-menu), `Marketplace` |

The Console hides the Project surface until the user explicitly opts
into authoring (clicks "Customize this environment" or "New Project").

### Field migration

Today, all runtime concerns sit on `sys_project`. We **keep the
physical table name `sys_project`** (cheap backwards-compat) but
relabel it conceptually as Environment in the UI. v2 of this ADR
defers the structural split to Phase 1 — and reframes it as:

- **Phase 1 schema** introduces a separate authoring table
  `sys_project_metadata` (or rename `sys_project` → `sys_environment`
  via view alias) and a sibling `sys_project_metadata` for the
  authoring concept. Installation FK migrates to
  `environment_id` (was `project_id`, same column physically).
- **Backwards compatibility**: `sys_project` continues to exist as the
  underlying table and is the source of truth for runtime data; the
  ORM exposes both `sys_project` (legacy) and `sys_environment` (new
  preferred name) — see ADR-0005 overlay precedent.

### Backward compatibility

The conceptual rename is UI-only in Phase 0. All API URLs
(`/api/v1/cloud/projects`), all SDK methods (`provisionProject`), and
all DB column names stay. We only change:

- Display labels (`label: 'Environment'`, `pluralLabel: 'Environments'`)
- Toast messages (`'Environment provisioned.'`)
- Console nav (`Environments`, not `Projects`)

When Phase 1 introduces a true authoring `sys_project_metadata` table,
the existing `sys_project` rows continue to function as Environments
with no migration required. Existing SDK callers continue to compile.

### Console UX impact

The migrated `cloud_control` app changes in three ways:

1. The **Projects** nav group is renamed to **Environments**.
2. The **Create Project** primary button becomes **Create Environment**
   with a cleaner form: starter package picker → display name →
   plan + driver + storage. The new form is the only blueprint-aware
   surface; there is no separate "template" concept (ADR-0003).
3. **Project metadata authoring surface** (revisions, branches,
   customization overlays) is deferred to Phase 1 and lives under
   a separate **Developer** nav group, hidden by default.

---

## Consequences

### Positive

1. **Consumer-friendly first run.** A user installing ACME CRM never
   has to define a "Project". They click `+ New Environment`,
   pick the starter package, and get a hostname.
2. **Marketplace promotion story.** "Promote `staging` to `prod`" is
   `INSERT INTO sys_package_installation (env_id, package_version_id)
   SELECT 'prod-env', package_version_id FROM sys_package_installation
   WHERE env_id = 'staging-env'`.
3. **Per-env version pinning** unblocks the Marketplace install model
   ("templates as packages"). Phase 1 introduces
   `sys_deployment` for the M:N project↔env join used by Builder
   persona.
4. **Clean form UX.** Create Environment no longer forces driver /
   storage decisions before the user understands the platform — they
   are env-level concerns made when creating the env, but with sane
   defaults (free / memory / 1 GB).
5. **RBAC layering.** Project-level "viewer / editor / admin" maps to
   metadata authoring; environment-level "deploy / suspend /
   read-logs" maps to runtime ops. Phase 1 splits the role enums.

### Negative / Costs

1. **Documentation churn.** Every page that said "project" has to
   audit whether it means "runtime environment" or "authoring
   project". One-time tax.
2. **Phase 1 schema work** introduces a `sys_project_metadata` (or
   equivalent) table and a `sys_deployment` join table. Done online
   behind a feature flag.
3. **SDK rename window.** New `provisionEnvironment` /
   `listEnvironments` methods sit alongside `provisionProject` /
   `listProjects` for one major version, then the latter deprecate.

### Neutral

1. Existing `sys_project` rows continue to work — they are
   Environments. No data migration needed in Phase 0.
2. `apps/cloud` worker routing (`*.{ROOT_DOMAIN}` → DO) stays
   `hostname → sys_project`. Same mechanism, more accurate UI naming.

---

## Phasing

| Phase | Scope | Status |
|----|----|----|
| **0 — UI relabel + foundation** | This ADR (v2); `is_starter` + `publisher` on `sys_package`; session auth on `/api/v1/cloud/*`; Console rename `Projects → Environments`; storage spinbutton bug; approvals badge stub | **Done** (this PR) |
| **1 — Schema sibling split** | `sys_project_metadata` (or rename to `sys_environment` via alias) + `sys_deployment` table; per-env install FK; Developer nav group | Next |
| **2 — Builder wizard** | "Customize this Environment" flow (creates project + initial revision); branch UI; revision history; per-env install picker | Following |
| **3 — Promotion + Quota rollup** | Cross-env package promotion; quota composition (org = Σ env); usage charts | Later |

Each phase is independently shippable behind a feature flag
(`cloud.threeLayer=true` resolved per-org).

---

## Open questions (deferred to Phase 1)

- **Authoring table name**: `sys_project_metadata`, `sys_solution`,
  or rename `sys_project` → `sys_environment` and re-use `sys_project`
  for authoring? Recommend the rename + reuse because it surfaces
  the conceptual cleanup to operators (one breaking
  schema-introspection change) instead of accumulating "history-suffixed"
  table names.
- **Per-env vs per-project quotas**: should the bill aggregate at
  project level (with sub-allocations to envs) or at env level
  (with optional project caps)? Recommend env-level primary with
  optional project-level cap, mirroring how AWS sub-accounts work.
- **Default environment policy on first signup**: auto-create one
  `prod` env, or wait for the user to click? Recommend auto-create —
  the empty Console is unwelcoming.

---

## References

- ADR-0002 — Environment-Per-Database Isolation
- ADR-0003 — Package as First-Class Citizen (starter packages
  eliminate the legacy "template" concept)
- ADR-0005 — Metadata Customization Overlay (overlays apply at the
  project layer when Phase 1 lands)
- `/Users/zhuangjianguo/.copilot/session-state/8445ca18-486f-41e8-aa08-f6869d28aecb/plan.md`
  §12.3 — original three-layer-model recommendation
- `packages/services/service-tenant/src/objects/sys-project.object.ts`
  — current single-table model; relabelled in Phase 0


