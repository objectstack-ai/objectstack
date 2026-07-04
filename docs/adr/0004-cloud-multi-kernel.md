# ADR-0004: Cloud Control Plane + Per-Project Kernels

> **v5.0 update (2026):** Throughout this document, the term *project* has been renamed to *environment* (no aliases; CLI flags, URL paths, schemas, env vars all hard-renamed). See ADR-0006 for the rationale and `.changeset/v5-project-to-environment-rename.md` for the breaking-change list. The body below is preserved verbatim for historical context.


**Status**: Superseded (2026-04-23) — the physical split between `apps/cloud`
and `apps/objectos` was reversed. The control-plane and data-plane plugin
groups now live in a single unified `apps/objectos` process, differentiated by
the plugin pack loaded at boot (`createControlPlanePlugins()` + multi-project
bootstrap). All other primitives — `KernelManager`, per-project kernels,
`sys_project.hostname` routing, `DefaultProjectKernelFactory` — remain
unchanged.

**Date**: 2026-04-22
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0002](./0002-environment-database-isolation.md) (environment-per-database), [ADR-0003](./0003-package-as-first-class-citizen.md) (package as first-class citizen)
**Consumers**: `apps/objectos`, `@objectstack/runtime`, `@objectstack/service-tenant`, Studio project management UI

---

## Context

After ADR-0002 and ADR-0003 landed, a single `apps/objectos` process owned three concerns simultaneously:

1. The **control plane**: `sys_project`, `sys_database_credential`, `sys_project_member`, billing, package registry.
2. The **data plane**: every project's ObjectQL traffic (`/api/v1/data/*`, `/api/v1/meta/*`, `/api/v1/ui/*`, `/api/v1/ai/*`).
3. The **tenant routing layer**: hostname/header/session → project → driver resolution.

All projects shared a **single `ObjectKernel`**. Multi-tenancy was achieved by injecting a different `dataDriver` on each request via `HttpDispatcher.resolveEnvironmentContext()`. This worked for early dogfooding but broke down in three ways:

1. **Plugin isolation is per-kernel, not per-request.** Projects that need different `AppPlugin`s, different feature flags, or different `ServicePlugin` versions cannot coexist in one kernel. Every request has to funnel through the same schema registry and event bus.
2. **Control-plane and data-plane lifecycles collide.** Rotating a project credential, pausing a project, or marking a tenant `failed` should never require restarting the control plane. With one process, they do.
3. **Horizontal scaling is coarse-grained.** Self-hosted users who run a single DB and no control plane still pay the cost of every sys-plugin (tenant, package, billing scaffolds). Cloud operators, conversely, want control-plane traffic and data-plane traffic scaled independently.

The Supabase/Power Platform topology solves this by splitting concerns physically:

| Concern             | Supabase            | Power Platform          | ObjectStack (this ADR)      |
|---------------------|---------------------|-------------------------|-----------------------------|
| Project registry    | Supabase platform   | Dataverse admin         | `apps/cloud`                |
| Per-project runtime | Postgres + PostgREST per project | Environment per org     | `ObjectKernel` per project  |
| Hostname routing    | `<ref>.supabase.co` | `<env>.crm.dynamics.com` | `<slug>.objectstack.app`   |

We want the same separation without forcing every deployment into the cloud topology — the self-hosted single-binary workflow must remain a first-class target.

---

## Decision

### 1. Hard split between Control Plane and Data Plane

Two deployable applications:

| App            | Role                           | Owns                                                                       | Kernel model          |
|----------------|--------------------------------|----------------------------------------------------------------------------|-----------------------|
| `apps/cloud`   | Control plane                  | `sys_project`, `sys_database_credential`, `sys_project_member`, `sys_package*`, auth, billing | **Single** shared kernel |
| `apps/objectos`  | Data plane (dual-mode)         | `/api/v1/data/*`, `/api/v1/meta/*`, `/api/v1/ui/*`, `/api/v1/ai/*`         | Single kernel *or* per-project kernels |

`apps/cloud` always runs as a single kernel — the control plane has one tenant (the platform itself).

`apps/objectos` runs in one of two modes, selected at boot by `OS_RUNTIME_MODE`:

- **`self-hosted` (default)** — behaves exactly like pre-ADR-0004. One kernel, full plugin set from `objectstack.config.ts`, datasource mapped via env vars. No control plane dependency.
- **`cloud`** — hostname → project routing. A `KernelManager` lazily boots a dedicated `ObjectKernel` per project, pulling project/credential/package metadata from `apps/cloud` via `OS_CONTROL_PLANE_URL`.

### 2. `KernelManager` + `ProjectKernelFactory` (new in `@objectstack/runtime`)

- **`KernelManager`** ([`packages/runtime/src/kernel-manager.ts`](../../packages/runtime/src/kernel-manager.ts)): LRU+TTL cache of `Map<projectId, CachedKernel>`. Exposes `getOrCreate(projectId)` (concurrent-safe, single-flight per id) and `evict(projectId)` (calls `kernel.shutdown()`). Configurable `maxSize` and `ttlMs`.
- **`DefaultProjectKernelFactory`** ([`packages/runtime/src/project-kernel-factory.ts`](../../packages/runtime/src/project-kernel-factory.ts)): given a `projectId`, reads project + credential + package-install rows from the control-plane driver, clones the base stack config, overrides the `default` datasource mapping to point at the project's driver, instantiates an `AppPlugin` per installed bundle, and calls `kernel.bootstrap()`.

Both are exported from `@objectstack/runtime`. Self-hosted mode never imports `KernelManager`.

### 3. `HttpDispatcher` is kernel-aware

`HttpDispatcher.dispatch()` now resolves a kernel before routing:

- If `kernelManager` is wired, resolve `projectId` (hostname → `sys_project.hostname`, then URL prefix, then `X-Project-Id`, then session), then `kernelManager.getOrCreate(projectId)`. Use that kernel's `RestServer` / `HttpServer` for the request.
- Otherwise, fall back to the shared kernel path — identical to pre-ADR-0004 behavior.

Control-plane routes (`/api/v1/cloud/*`) stay on `apps/cloud`'s kernel in both topologies.

### 4. Hostname as routing primitive

`sys_project.hostname` is the canonical routing key:

- Auto-assigned at provisioning time as `<org-slug>-<short-id>.objectstack.app` (default template; see `ProjectProvisioningService`).
- Editable by org admins via `POST /api/v1/cloud/projects/:id/hostname`, with uniqueness enforced at the service layer (returns 409 Conflict) and format validation (returns 400 Bad Request).
- Cache invalidation is explicit: updating a hostname calls `EnvironmentDriverRegistry.invalidate(projectId)` so the next request does a fresh lookup.

Custom domains and multi-hostname binding (ACME certificates, `sys_domain` table) are intentionally out of scope for this ADR.

### 5. Studio surfaces hostname as a first-class field

- Project list ([`apps/studio/src/routes/projects.index.tsx`](../../apps/studio/src/routes/projects.index.tsx)) renders a globe icon + hostname inline with the project card.
- Project detail ([`apps/studio/src/routes/projects.$projectId.index.tsx`](../../apps/studio/src/routes/projects.$projectId.index.tsx)) adds a **Domains** card with inline edit (Enter to save, Escape to cancel, toast on success/conflict).

---

## Consequences

### Positive

- **Plugin and metadata isolation is physical.** A misbehaving project's `AppPlugin` cannot corrupt another project's schema registry or event bus.
- **Self-hosted stays simple.** A single `OS_DATABASE_URL` env var is still enough to run a full ObjectStack backend; no sys plugins are required.
- **Control plane and data plane scale independently.** `apps/cloud` can run on a single node (low traffic, heavy consistency); `apps/objectos` in cloud mode can scale horizontally behind hostname-based load balancing.
- **Credential rotation never restarts the control plane.** Rotating `sys_database_credential` just invalidates the affected project's cached kernel; everything else keeps running.
- **Hostname routing is observable.** Studio shows the bound hostname; operators can verify routing with a single `curl -H 'Host: …'`.

### Negative / Trade-offs

- **First request to a cold project pays the kernel bootstrap cost** (typically 50–200 ms; dominated by driver handshake). Mitigated by LRU caching and optional warm-up hooks.
- **Memory scales with active-project count.** A 512 MB container comfortably holds ~100 active kernels with the default plugin set; operators must tune `KernelManager.maxSize` for their workload.
- **Two deploy targets to track.** CI now publishes `apps/cloud` and `apps/objectos` separately; self-hosters who don't need a control plane can ignore `apps/cloud` but must still pin to a matching version for cloud-mode upgrades.

### Migration

- Existing self-hosted deployments keep working unchanged. `OS_RUNTIME_MODE` defaults to `self-hosted`; no env var changes required.
- Pre-ADR-0004 cloud-style deployments (single `apps/objectos` with sys plugins) should split into `apps/cloud` + `apps/objectos` cloud-mode by Phase 2 of the rollout. A one-shot script that migrates existing `sys_project` rows out of the shared DB is bundled under `packages/services/service-tenant/migrations/`.

---

## Not in scope

- **Custom-domain TLS and ACME automation.** The `hostname` field accepts any valid hostname, but TLS termination remains the operator's responsibility (usually via the fronting CDN / ingress).
- **Cross-project kernel sharing / multi-tenant plugin pools.** Every project gets its own kernel in cloud mode; we do not reuse kernels across projects even when they share the same `AppPlugin` set.
- **Full `sys_domain` table for N:1 hostname→project.** MVP supports one hostname per project; multi-hostname binding is a future ADR.

---

## References

- Plan: `apps-server-sleepy-newell` (the plan this ADR crystallizes).
- Code: `packages/runtime/src/kernel-manager.ts`, `packages/runtime/src/project-kernel-factory.ts`, `packages/runtime/src/http-dispatcher.ts`, `apps/objectos/server/bootstrap.ts`, `apps/cloud/objectstack.config.ts`.
- Related guide: [Cloud vs Self-Hosted deployment](../../content/docs/deployment/index.mdx).
