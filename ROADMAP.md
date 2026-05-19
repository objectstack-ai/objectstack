# ObjectStack - Road Map

> **Last Updated:** 2026-05-08 (M9 Expression Unification + D9/D10/D11 added — CEL/AST-first migration plan)
> **Authoritative Spec:** [content/docs/concepts/north-star.mdx](content/docs/concepts/north-star.mdx) - §7 Alignment Check is the single source of truth for Built / Drift / Missing.
> This file is the **actionable checklist** derived from that ledger. When north-star §7 changes, update this file too.

---

## How to Read This File

| Symbol | Meaning |
|:---:|:---|
| ✅ | Shipped - code exists and is integrated |
| 🟡 | Partial / Drift - exists but wrong shape, needs evolution |
| 🔴 | Not started |
| ⛔ | Explicit non-goal - do not implement in Phase 1 |

Phase 1 is **code-first ObjectStack**:

- The local TypeScript workspace is the only user-metadata authoring surface.
- `objectstack compile` produces JSON.
- `objectstack publish` uploads that JSON to the control plane.
- Studio is a control-plane dashboard, metadata viewer, artifact inspector, and observability surface.
- ObjectOS pulls artifacts through HTTP and never reads control-plane DB tables directly.

The implementation path is therefore:

```
Artifact format -> control-plane metadata -> Artifact API -> ObjectOS loader -> publish endpoint -> Studio viewer
```

---

## ✅ Built (Aligned)

Code that exists and matches the intended architecture. Do not regress these.

| What | Code anchor |
|:---|:---|
| Organization CRUD + member/invitation system | [apps/studio/src/hooks/useSession.ts](apps/studio/src/hooks/useSession.ts) |
| Project CRUD + per-project Turso/memory DB provisioning | [packages/services/service-tenant/](packages/services/service-tenant/) |
| Per-project ObjectKernel with LRU cache | [packages/runtime/src/cloud/kernel-manager.ts](packages/runtime/src/cloud/kernel-manager.ts) |
| Hostname-based routing: `sys_project.hostname` -> kernel resolution | [packages/runtime/src/cloud/artifact-environment-registry.ts](packages/runtime/src/cloud/artifact-environment-registry.ts) |
| `ControlPlaneProxyDriver` - org-scoped data isolation | [apps/cloud/src/control-plane-proxy-driver.ts](apps/cloud/src/control-plane-proxy-driver.ts) |
| `AppCatalogService` - per-project app events -> org-scoped `sys_app` catalog | [packages/services/service-tenant/src/services/app-catalog.service.ts](packages/services/service-tenant/src/services/app-catalog.service.ts) |
| TS -> JSON compile pipeline (`objectstack compile`) | [packages/cli/src/commands/compile.ts](packages/cli/src/commands/compile.ts) |
| Zod -> JSON Schema publishing (`z.toJSONSchema`) - TS/JSON bridge | [packages/spec/scripts/build-schemas.ts](packages/spec/scripts/build-schemas.ts) |
| Scaffolded TS file tree (`create-objectstack` -> `defineStack()` + split `src/objects/*.ts`) | [packages/create-objectstack/src/index.ts](packages/create-objectstack/src/index.ts) |
| JSON-payload metadata column (`sys_metadata.metadata` textarea) | [packages/metadata/src/objects/sys-metadata.object.ts](packages/metadata/src/objects/sys-metadata.object.ts) |
| CLI `publish` - local JSON -> remote server wire (endpoint shape still wrong, see D2) | [packages/cli/src/commands/publish.ts](packages/cli/src/commands/publish.ts) |
| **M1** Project Artifact envelope schema (`schemaVersion / projectId / commitId / checksum / metadata / functions / manifest`) | [packages/spec/src/system/project-artifact.zod.ts](packages/spec/src/system/project-artifact.zod.ts) |
| **M3 / M4** Cloud Artifact API + runtime loader (`/cloud/resolve-hostname`, `/cloud/projects/:id/artifact`, `/cloud/projects/:id/metadata` + `ArtifactKernelFactory`) | [packages/services/service-cloud/src/cloud-artifact-api-plugin.ts](packages/services/service-cloud/src/cloud-artifact-api-plugin.ts) |
| Single-project boot mode (`OS_MODE=standalone`) — `createSingleProjectPlugin` seeds local org/project + serves `studio/runtime-config` | [packages/services/service-cloud/src/single-project-plugin.ts](packages/services/service-cloud/src/single-project-plugin.ts) |
| Static Setup App (no runtime `SetupPlugin`) — fixed `App` artifact registered by `plugin-auth` | [packages/platform-objects/src/apps/setup.app.ts](packages/platform-objects/src/apps/setup.app.ts) |
| ~~Formula expression evaluator (text / math / date / logical)~~ — see D9 (replaced by CEL via M9) | [packages/objectql/src/formula.ts](packages/objectql/src/formula.ts) |
| Studio Flow Viewer + Flow Test Runner + Flow Runs panel | [apps/studio/src/components/FlowViewer.tsx](apps/studio/src/components/FlowViewer.tsx) |
| Automation: flow auto-discovery from ObjectQL registry | [packages/services/service-automation/src/plugin.ts](packages/services/service-automation/src/plugin.ts) |
| **D1** ObjectOS metadata DB bridge removed - `MetadataPlugin` no longer registers `sys_metadata` / `sys_metadata_history` or auto-bridges ObjectQL to `DatabaseLoader` | [packages/metadata/src/plugin.ts](packages/metadata/src/plugin.ts) |
| **S1** REST `requireAuth` gate + `resolveExecCtx` hostname routing (resolved 2026-05-18) — anonymous `/api/v1/data/*` returns 401 on multi-tenant ObjectOS hosts (CRUD + batch routes both gated). Auto-enabled when `tierEnabled('auth')`; force-enabled on `createObjectOSStack`. `resolveExecCtx` now mirrors `resolveProtocol`'s hostname→projectId mapping so authenticated users on hostname-routed projects can read their own org's data. **Verified live on crm.objectos.app**: anonymous=401, user A=200 (own org records), user B=200 (different org, isolated). Original CF "two accounts see same data" complaint closed. | [packages/rest/src/rest-server.ts](packages/rest/src/rest-server.ts), [packages/runtime/src/cloud/objectos-stack.ts](packages/runtime/src/cloud/objectos-stack.ts), [packages/cli/src/commands/serve.ts](packages/cli/src/commands/serve.ts) |

---

## 🟡 Drift (Needs Cleanup)

Existing code that contradicts the intended Phase 1 architecture. Fix these before building new surface area that depends on them.

### D2 - `objectstack publish` uses legacy `/api/v1/packages` endpoint

[packages/cli/src/commands/publish.ts](packages/cli/src/commands/publish.ts) POSTs a "package" payload that is not the Phase 1 project metadata endpoint.

**Required evolution:**
- Endpoint: `POST /api/v1/cloud/projects/:projectId/metadata`
- Payload: compiled `dist/objectstack.json` (output of `objectstack compile`)
- Server behavior: validate with Zod, write current project metadata state, create `commitId`, compute checksum
- Response: `{ projectId, commitId, checksum }`

### D3 - Remove `env_id` from metadata storage

**Decision (2026-04-25): delete, don't repurpose.** Phase 1 metadata is scoped by `organization_id` + `project_id`. Deployment target differences are runtime/deployment configuration, not metadata row partitioning. Branch-like variants are explicitly deferred.

**Fix path:**
1. Add/control-plane metadata ownership columns: `organization_id` + `project_id`.
2. Backfill existing rows to the owning organization/project.
3. Delete `env_id` column and all references.
4. Update unique indexes from environment-scoped keys to project-scoped keys.

Known anchors to scrub:
- [packages/metadata/src/objects/sys-metadata.object.ts](packages/metadata/src/objects/sys-metadata.object.ts)
- [packages/metadata/src/objects/sys-metadata-history.object.ts](packages/metadata/src/objects/sys-metadata-history.object.ts)
- [packages/metadata/src/loaders/database-loader.ts](packages/metadata/src/loaders/database-loader.ts)
- [packages/metadata/src/projection/metadata-projector.ts](packages/metadata/src/projection/metadata-projector.ts)
- [packages/metadata/src/utils/history-cleanup.ts](packages/metadata/src/utils/history-cleanup.ts)
- [packages/objectql/src/plugin.ts](packages/objectql/src/plugin.ts)
- [packages/objectql/src/protocol.ts](packages/objectql/src/protocol.ts)
- [packages/client/src/index.ts](packages/client/src/index.ts)

### D4 - ✅ `namespace` residue (resolved 2026-04-26)

Object identity is now single-sourced on `name`. The deprecated `namespace`
field has been removed from `ObjectSchemaBase` ([packages/spec/src/data/object.zod.ts](packages/spec/src/data/object.zod.ts))
and the schema strips the key from any legacy input. Package-level namespace
(used by the registry for FQN computation, marketplace publishing, and
DatasourceRoutingRule) is intentionally retained — it is a separate mechanic.

### D5 - ✅ Plugin `scope` enum trimmed (resolved 2026-04-26)

`ManifestSchema.scope` is now a clean three-value enum (`'cloud' | 'system' | 'project'`).
The deprecated `'platform'` and `'environment'` aliases have been removed
([packages/spec/src/kernel/manifest.zod.ts](packages/spec/src/kernel/manifest.zod.ts)).

### D6 - Half-wired abstractions

`ScopedServiceManager` and `SharedProjectPlugin` were added but their integration into the request path is incomplete. Either finish them or remove them.

### D6b - `packages/services/service-cloud` mixes runtime + control-plane (resolved 2026-05-17 — Phase R)

The package historically housed three unrelated concerns under one name:

1. **ObjectOS runtime** (artifact-fetching, per-project kernel manager, auth proxy) — used by `apps/objectos`
2. **Cloud control plane** (multi-project orchestration, templates, local-identity seeding) — used by `apps/cloud`
3. **Legacy single-project shells** (`single-project-plugin`, `shared-project-plugin`, `multi-project-plugin`) — pre-artifact-API code

This forced `apps/objectos` to depend on `@objectstack/service-cloud` — a "cloud service" package — even though objectos only needs a runtime that pulls compiled artifacts over HTTP. The dispatcher (`boot-stack.ts`) that bridged the two was an `if/else` over `OS_MODE`.

**Phase R — completed:**

- Runtime-side files (`artifact-api-client`, `artifact-environment-registry`, `artifact-kernel-factory`, `auth-proxy-plugin`, `kernel-manager`, `objectos-stack`, plus new `file-artifact-api-client`) live in [`packages/runtime/src/cloud/`](packages/runtime/src/cloud/) and are exported from `@objectstack/runtime`.
- `apps/objectos/objectstack.config.ts` now imports `createObjectOSStack` from `@objectstack/runtime` directly. No `@objectstack/service-cloud` dependency.
- `apps/cloud/objectstack.config.ts` calls `createCloudStack` from `@objectstack/service-cloud` directly. The `createBootStack` dispatcher is removed.
- Dead duplicates (`packages/runtime/src/{kernel-manager,multi-project-plugin,project-kernel-factory,environment-registry,control-plane-proxy-driver}.ts`) and legacy plugins in `service-cloud` (`single-project-plugin`, `shared-project-plugin`, `multi-project-plugin`, …) are deleted.
- Result: `service-cloud` shrinks from 5 294 LOC / 27 files to the cloud-only control-plane core; the runtime no longer has a "cloud" dependency.

### D7 - ✅ Plugin-config churn converged (resolved 2026-04-26)

Each plugin's manifest header + objects list now lives in a single canonical
`src/manifest.ts` per plugin. Both `objectstack.config.ts` (compile-time) and
the plugin's runtime `manifest.register()` import from that file, eliminating
the empty-`./src/objects/` divergence that previously caused `plugin-auth` and
`plugin-security` to ship empty object lists from compile while their runtimes
registered the real schemas.

Anchors:
- [packages/plugins/plugin-auth/src/manifest.ts](packages/plugins/plugin-auth/src/manifest.ts)
- [packages/plugins/plugin-security/src/manifest.ts](packages/plugins/plugin-security/src/manifest.ts)
- [packages/services/service-tenant/src/manifest.ts](packages/services/service-tenant/src/manifest.ts)

### D9 - Custom Salesforce-flavor formula engine (replace with CEL)

[packages/objectql/src/formula.ts](packages/objectql/src/formula.ts) is a hand-written 433 LoC recursive-descent parser exposing 22 functions (UPPER / NOW / TODAY / IF / AND …). It is the only "real" expression engine in the repo, but:

- **No public training corpus.** AI agents have to learn our private DSL from scratch every prompt.
- **Silent failure mode.** `evaluateFormula` wraps the whole evaluator in `try { … } catch { return undefined }`. Business rules fail open with no signal.
- **No execution bounds.** No recursion depth limit, no step counter, no timeout. Untrusted input is a DoS vector.
- **Salesforce-incomplete.** 22 functions vs 100+ in the language we'd be cloning.
- **Single-engine bet.** All formula / predicate / condition fields share the same evaluator regardless of security posture.

**Decision (2026-05-08):** delete and replace with CEL. Salesforce compatibility is **not** a goal — see `content/docs/concepts/north-star.mdx` §8. See M9 Expression Unification below.

### D10 - Untyped `z.string()` expression fields scattered across spec

~25 fields named `formula / condition / expression / criteria / visible / visibleOn` are declared as bare `z.string()` with `.describe('Formula expression')`. These are not all the same language — they include Salesforce-style formulas, predicate conditions, JS expressions (mapping), cron expressions (job), SQL fragments (analytics joins, partial indexes), and OpenAPI runtime expressions (rest-server callbacks). None are typed, none declare a dialect.

Anchors (non-exhaustive):
- [packages/spec/src/data/field.zod.ts](packages/spec/src/data/field.zod.ts) — `formula.expression`, `conditionalRequired`
- [packages/spec/src/data/validation.zod.ts](packages/spec/src/data/validation.zod.ts) — `condition`, `scope`
- [packages/spec/src/data/hook.zod.ts](packages/spec/src/data/hook.zod.ts) — `condition`
- [packages/spec/src/ui/{app,page,view,action}.zod.ts](packages/spec/src/ui) — `visible / visibility / visibleOn / disabled`
- [packages/spec/src/security/sharing.zod.ts](packages/spec/src/security/sharing.zod.ts) — `condition`
- [packages/spec/src/automation/{workflow,approval}.zod.ts](packages/spec/src/automation) — `criteria`, `entryCriteria`
- [packages/spec/src/ai/{orchestration,predictive}.zod.ts](packages/spec/src/ai) — `condition`, `entryCriteria`, `dataFilter`
- [packages/spec/src/kernel/feature.zod.ts](packages/spec/src/kernel/feature.zod.ts) — `expression`

**Resolved by:** M9 — replace with `ExpressionSchema { dialect, ast }` (string shorthand accepted as input, AST emitted in artifact).

### D11 - Compile-time-frozen seed timestamps in `Dataset.records`

[examples/app-crm/src/data/index.ts](examples/app-crm/src/data/index.ts) uses `new Date(Date.now() + 86400000 * 30)` and similar patterns inside seed records. These are evaluated at TS compile time, baking the developer's wall-clock into `dist/objectstack.json`:

- Two consecutive `objectstack build` runs produce **non-byte-identical** artifacts (timestamps drift seconds-to-minutes apart). This violates the implicit "deterministic build" contract for cacheable artifacts.
- Customers installing the package later receive seed dates anchored to **the developer's** "today + 30 days", forever. The dynamic semantics intended by the developer are lost.

**Resolved by:** M9 — `Dataset.records` accepts `SeedValue = primitive | Expression`; SeedLoader evaluates expressions at install time using the customer's clock and identity context.

### D8 - `apps/objectos` is a hybrid (Control Plane + ObjectOS in one process)

[apps/objectos/objectstack.config.ts](apps/objectos/objectstack.config.ts) currently registers control-plane and ObjectOS concerns on the same `ObjectKernel`. North-star §5 names these as two separate vertices; implementation should follow.

**Decision:** split into **`apps/cloud`** (Control Plane Server) and **`apps/objectos`** (ObjectOS Runtime). Both are ObjectStack-framework apps booted from their own `objectstack.config.ts`. They share the same `ObjectKernel`, spec, and adapter stack. They differ only in their plugin manifest.

**Plugin partition:**

| Plugin | `apps/cloud` (Control Plane) | `apps/objectos` (ObjectOS) |
|:---|:---:|:---:|
| `createControlPlanePlugins(...)` (ObjectQL on control DB + driver + system-project + sys_* metadata) | Yes | - |
| `MultiProjectPlugin` (`env-registry`, `kernel-manager`, `template-seeder`) | Yes | - |
| `AuthPlugin` | Yes | Yes |
| `createTenantPlugin(...)` | Yes | Yes |
| `SecurityPlugin` | Yes | Yes |
| `AuditPlugin` | Yes | Yes |
| `SetupPlugin` (Studio bootstrap) | Yes (optional) | - |
| `ObjectQLPlugin` (project-scoped) | - | Yes |
| `MetadataPlugin` (artifact-loader mode - see M4) | - | Yes |
| User-app `AppPlugin` (compiled app) | - | Yes |

**Fix path:**
1. Create `apps/cloud/` with its own `objectstack.config.ts` carrying the Control Plane manifest above.
2. Strip control-plane plugins out of [apps/objectos/objectstack.config.ts](apps/objectos/objectstack.config.ts); reduce it to the ObjectOS manifest.
3. Decide deployment topology (separate Vercel projects vs. one repo / two entrypoints).

**Depends on:** M3, M4. Until ObjectOS can boot from Artifact API, `apps/objectos` cannot run standalone.

---

## 🔴 Missing (Not Started)

Ordered by dependency. Items higher in the list unblock those below them.

### M1 - ✅ Artifact format v0 (resolved 2026-04-26)

- [x] Add a Zod schema for the artifact envelope.
- [x] Minimum envelope: `schemaVersion`, `projectId`, `commitId`, `checksum`, `metadata`, `functions`, `manifest`.
- [x] Specify function-code packaging (`ProjectArtifactFunctionSchema`: name + language + inlined `code` + optional source/hash) and plugin/driver requirement declaration (`ProjectArtifactManifestSchema`: plugins, drivers, engine).
- [x] Required: schemaVersion / projectId / commitId / checksum / metadata / manifest. Optional: builtAt / builtWith / payloadRef.
- [x] Reserved `payloadRef` for future S3 indirection (`{ url, expiresAt, checksum }`).

Code anchor: [packages/spec/src/system/project-artifact.zod.ts](packages/spec/src/system/project-artifact.zod.ts).
Tests: [packages/spec/src/system/project-artifact.test.ts](packages/spec/src/system/project-artifact.test.ts).

**Prerequisite for:** M3, M4.

### M1.x - Runtime Inputs 边界化

明确 ObjectOS 启动输入 = **Artifact**（不可变、可缓存的元数据信封）+ **Deployment Config**（业务 DB 坐标、凭据、项目身份、密钥；不进 artifact）。详见 [north-star.mdx §6.3](content/docs/concepts/north-star.mdx)。

- [x] north-star.mdx §6.3 增补 Runtime Inputs 节（含本地单 project env 表 + 反模式说明）
- [x] 实现本地 standalone / cloud env 路径：`OS_MODE` (旧 `OS_MULTI_PROJECT`) / `OS_PROJECT_ID` / `OS_DATABASE_URL` / `OS_DATABASE_DRIVER` / `OS_ARTIFACT_PATH`（默认 `./dist/objectstack.json`）/ `AUTH_SECRET`
- [x] 修复 Drift：`ProjectKernelFactory` 不再直连控制面 DB 读 `sys_project` / `sys_project_credential`，改走 Artifact API + Deployment Config 注入（`localProject` 分支）
- [x] [apps/objectos/objectstack.config.ts](apps/objectos/objectstack.config.ts) 的 env 命名收敛到 `OS_*` 前缀，`isLocalMode` 分流本地/云端路径

**Resolves:** Open Question §9.2（已解决）+ 新增 Drift（`ProjectKernelFactory` 绕过 Artifact API）。

### M2 - Metadata migration to control plane

- [ ] Move user metadata out of project DBs into the control-plane DB.
- [ ] Scope metadata rows by `organization_id` + `project_id`.
- [ ] Add or update unique keys for `project_id` + metadata `type` + metadata `name`.
- [ ] Data migration script for existing installations.
- [ ] Keep project DBs for business rows only.

**Prerequisite for:** M3, D3.

### M3 - ✅ Project Artifact API endpoint (resolved 2026-04-30)

- [x] `GET /api/v1/cloud/projects/:projectId/artifact` - assembles the current project's metadata + inlined function code into a single consumable blob.
- [x] Validate the outgoing artifact with the M1 Zod schema.
- [x] Content hash / ETag for cache validation. (Synthetic `sha256`-prefixed `commitId` + `checksum` minted when the source bundle does not provide them.)
- [x] Response includes `commitId` and `checksum`.
- [x] Reserve response shape for future `{ url, expiresAt, checksum }` indirection, but do not build S3 yet.

Code anchor: [packages/services/service-cloud/src/cloud-artifact-api-plugin.ts](packages/services/service-cloud/src/cloud-artifact-api-plugin.ts).
Docs: [content/docs/concepts/cloud-artifact-api.mdx](content/docs/concepts/cloud-artifact-api.mdx).

**Prerequisite for:** M4.

### M4 - ✅ ObjectOS artifact loader (resolved 2026-04-30)

- [x] `MetadataPlugin` production source: HTTP fetch against Artifact API. (`ArtifactApiClient` + `ArtifactKernelFactory`.)
- [x] Validate artifact with Zod before hydrating kernel.
- [x] Local artifact cache with durability across control-plane outages. (TTL cache in `ArtifactApiClient`.)
- [x] Cache key by `projectId` + `commitId`/`checksum`.

Code anchor: [packages/services/service-cloud/src/artifact-kernel-factory.ts](packages/services/service-cloud/src/artifact-kernel-factory.ts).

**Completes:** production ObjectOS artifact source.

### M5 - Project publish endpoint

- [x] `POST /api/v1/cloud/projects/:projectId/metadata` - receives compiled JSON. *(server side shipped 2026-04-30 alongside M3; see `cloud-artifact-api-plugin.ts`.)*
- [ ] Validates payload with `ObjectStackDefinitionSchema` or the canonical compiled stack schema.
- [ ] Writes current project metadata state to control-plane storage.
- [ ] Creates `commitId`, computes checksum, and returns `{ projectId, commitId, checksum }`.
- [ ] Evolves [packages/cli/src/commands/publish.ts](packages/cli/src/commands/publish.ts) to call this endpoint.

**Resolves:** D2.

### M6 - Studio metadata/artifact viewer

- [ ] Project metadata browser for Objects / Fields / Functions / Views / Flows / Agents.
- [ ] Artifact inspector: schema version, commit id, checksum, publish time, payload preview.
- [ ] Publish history list.
- [ ] Runtime health/logs panels.
- [ ] Explicitly read-only for user metadata.

### M7 - `objectstack dev` offline boot path

- [ ] `from-local-file` kernel boot mode: ObjectOS reads `dist/objectstack.json` (or in-memory TS definition) and runs without a control-plane connection.
- [ ] Wire as a distinct boot mode; does not pollute the production `from-artifact-api` path.
- [ ] `objectstack dev` CLI command triggers this mode.

**Open question:** should `dev` consume TS directly (hot reload friendly) or compile-first (production-path parity)?

### M8 - UI auto-generation

- [ ] Artifact schemas -> Amis/React components without hand-wiring.

### M9 - Expression Unification (CEL + AST-first)

Single canonical expression language across all metadata domains. Replace the
custom formula engine (D9), the scattered `z.string()` expression fields (D10),
and the compile-time-frozen seed timestamps (D11) with one tagged
`ExpressionSchema { dialect, ast }` whose persisted form is always an AST.

**Strategic rationale.** Future authors of metadata and formulas are AI agents,
not human admins. The wire format must therefore have (a) abundant public
training corpus, (b) formal grammar, (c) AST-first persistence (no parsing
ambiguity, structured-output friendly), (d) sandboxed bounded execution.
**CEL** (Google Common Expression Language, Apache-2.0) satisfies all four;
the existing custom DSL satisfies none. **Salesforce flavor is explicitly not
a goal** — see north-star §8.

**Dialect map:**

| dialect | engine | use cases |
|:---|:---|:---|
| `cel` | `cel-js` + ObjectStack stdlib | formula fields, predicates (condition / criteria / visible), seed dynamic values |
| `js` | isolated-vm / quickjs (existing) | L2 hook bodies (`packages/spec/src/data/hook-body.zod.ts` ScriptBody) |
| `cron` | `cron-parser` | `system/job.zod.ts` schedule |

SQL fragments (analytics joins, partial indexes) stay driver-native and are
**not** unified into the expression registry — they have a different security
and portability posture.

#### M9.1 - `packages/formula` package + ExpressionSchema ✅

- [x] New `packages/formula/` with `cel-js` integration.
- [x] ObjectStack CEL stdlib: `now()`, `today()`, `daysFromNow(n)`, `daysAgo(n)`, `isBlank(v)`, `coalesce(v, fallback)`, plus `record.*` / `previous.*` / `input.*` / `os.user.*` / `os.org.*` / `os.env` variable scope.
- [x] `packages/spec/src/shared/expression.zod.ts` exports `ExpressionDialect`, `ExpressionSchema`, `ExpressionInputSchema`, `PredicateSchema`.
- [x] `ExpressionEngine` registry with `evaluate(expr, ctx)` single entrypoint.

#### M9.2 - DX shorthand (build-time only) ✅ (partial)

- [x] `cel\`...\``, `F\`...\`` (formula), `P\`...\`` (predicate) tagged-template helpers exported from `@objectstack/spec`.
- [ ] `objectstack compile` normalizes any `source` string in input metadata into `ast`. **Deferred to M9.7** — current artifact carries `{ dialect, source }`; AST emission lands with the AI structured-output milestone.

#### M9.3 - Replace scattered `z.string()` expression fields ✅

- [x] Migrated all ~25 fields listed in D10 to `ExpressionInputSchema`. Input accepts `string | Expression` for back-compat; output is the canonical `Expression` envelope.
- [x] Surfaces migrated: `Field.formula` (formula type), `Field.conditionalRequired`, `Field.visibleOn`, `ConditionalValidation.when`, `ObjectFieldGroup.visibleOn`, `View.visibleOn`, `View.criteria`, `Action.disabled`, `Hook.condition`, `SharingRule.condition`, `Flow.decision.expression`, `Mapping.transform` (js dialect), `Job.schedule.expression` (cron dialect).
- [x] Spec test suite updated (6840 passing).

**Resolves:** D10.

#### M9.4 - Seed dynamic values ✅

- [x] `Dataset.records` accepts `SeedValue = primitive | Expression | nested`.
- [x] `SeedLoader.load()` walks records, calls `ExpressionEngine.evaluate` with a per-load pinned `now` before write. `seedCtx` exposes `os.user / os.org / os.env` from the install environment.
- [x] CRM example: 48 dynamic dates migrated from `new Date()` (compile-time) to `cel\`daysFromNow(N)\`` / `cel\`daysAgo(N)\`` (install-time).

**Resolves:** D11.

#### M9.5 - Delete custom formula engine ✅

- [x] `packages/objectql/src/engine.ts` (computed fields, `planFormulaProjection` / `applyFormulaPlan`) and `packages/objectql/src/hook-wrappers.ts` (hook conditions) call `ExpressionEngine.evaluate`.
- [x] **Deleted** the legacy `packages/objectql/src/formula.ts` recursive-descent parser and `packages/spec/docs/formula-functions.md`.

**Resolves:** D9.

#### M9.6 - Migrate `examples/app-crm` ✅

- [x] All 4 CRM formula fields (`lead.full_name`, `contact.full_name`, `campaign.response_rate`, `campaign.roi`) re-written in CEL using `coalesce(...)` / ternary patterns.
- [x] CI determinism gate: two consecutive `objectstack build` runs produce byte-identical `dist/objectstack.json` (SHA-1 `91efccc…`).
- [x] `planFormulaProjection` fix: formulas are now evaluated even when REST returns the default projection (no explicit `?fields=`).
- [x] Browser-verified end-to-end via `pnpm dev:crm`: `Lead.full_name` renders "Lisa Thompson", `Campaign.roi` renders `1907.04`.
- [ ] _Follow-up:_ ~22 inert validation/sharing `condition:` strings on other CRM objects still use Salesforce flavor (not yet evaluated by runtime — no validation engine wired). Migrate when validation engine lands.

#### M9.7 - AI structured-output integration

- [ ] Publish `CelExprSchema` as JSON Schema for AI constrained decoding.
- [x] New [`skills/objectstack-formula/SKILL.md`](skills/objectstack-formula/SKILL.md) — mandates CEL-only emission, lists stdlib, gives mandatory patterns and the legacy → CEL translation table.
- [ ] Wire structured-output prompts into Studio AI assistant + CLI scaffolding.

#### M9.8 - Studio visual expression editor

- [ ] Node-graph editor backed directly by `CelExprSchema`. No string parser needed in Studio. Deferred — depends on M6.

#### M9.9 - Spec-wide Expression coverage sweep (NEW — 2026-05-08) ✅ COMPLETE

A full audit across all 15 protocol domains identified surfaces that still
escape the canonical envelope. M9.3 fixed the 25 obvious formula/predicate
fields; this milestone closes the gaps in adjacent semantic categories.

**Status:** All 5 sub-milestones (a–e) shipped 2026-05-08. Engines: real
`cron-engine` + `template-engine` registered alongside `cel`. CRM example
fully migrated (codemod) and remains byte-identical across builds
(`e2af9e57…`). Flow runtime now routes `dialect:'cel'` conditions through
`@objectstack/formula` with a `vars.*` scope; legacy `{var}` template syntax
preserved for back-compat.

##### M9.9a - Bare `z.string()` predicates / formulas to migrate

- [x] `automation/workflow.zod.ts` `Task.dueDate` (documented "ISO string or formula") → `z.union([z.string(), ExpressionInputSchema])` so authors can write `cel\`daysFromNow(3)\``.
- [x] `api/graphql.zod.ts` `ComputedField.expression` ("Computation expression") → `ExpressionInputSchema`.
- [x] `ai/runtime-ops.zod.ts` `customCondition` → `ExpressionInputSchema` (predicate semantics identical to `Hook.condition`).
- [x] `kernel/metadata-loader.zod.ts` `filter: 'Filter predicate as string'` → `ExpressionInputSchema`.
- [x] `ui/component.zod.ts` `Form.onSubmit: 'Action expression on form submit'` → disambiguate: action reference vs CEL predicate; pick one shape.

##### M9.9b - `defaultValue` accepts Expression for derived defaults

- [x] `data/field.zod.ts` `Field.defaultValue: z.unknown()` → `z.union([z.unknown(), ExpressionSchema])` so authors can write `defaultValue: cel\`today()\`` or `cel\`os.user.id\`` instead of writing a hook.
- [x] Same change for `data/external-lookup.zod.ts`, `ui/page.zod.ts`, `ui/dashboard.zod.ts`, `api/export.zod.ts`.
- [x] DataEngine on insert: when `defaultValue.dialect` is set, evaluate via `ExpressionEngine` with the request-time identity context.

##### M9.9c - Cron strings normalize to `{ dialect: 'cron', source }`

10 sites still ship bare `z.string().describe('Cron expression…')` instead of using the canonical envelope (`Job.schedule.expression` already does it):

- [x] `integration/connector.zod.ts` `schedule`
- [x] `automation/etl.zod.ts` `schedule`
- [x] `automation/execution.zod.ts` `cronExpression`
- [x] `api/export.zod.ts` `cronExpression` (×2)
- [x] `system/disaster-recovery.zod.ts` `schedule` (×2)
- [x] `system/cache.zod.ts` `schedule`
- [x] `ai/predictive.zod.ts` `retrainSchedule`
- [x] `ai/orchestration.zod.ts` `cron`
- [x] `ai/devops-agent.zod.ts` `iterationFrequency`

Persist as `ExpressionInputSchema` so AI authors emit one envelope shape regardless of domain. Engine wraps `cron-parser`.

##### M9.9d - Add `template` dialect for string interpolation

Today every domain reinvents `{{var}}` interpolation:

- `system/notification.zod.ts` — Email `subject`/`body`, SMS `message`, Push `body`
- `data/object.zod.ts` — `titleFormat: '{name} - {code}'`
- `integration/connector/github.zod.ts` — `messageTemplate`, `titleTemplate`, `bodyTemplate`, `releaseNameTemplate`
- `ai/model-registry.zod.ts` / `ai/orchestration.zod.ts` / `ai/mcp.zod.ts` — prompt templates
- `api/graphql.zod.ts` — cache key / query templates

- [x] Add `'template'` to `ExpressionDialect` enum.
- [x] `@objectstack/formula` engine for `dialect: 'template'` — strict Mustache subset (`{{path.to.value}}` only, no logic), same variable scope as CEL (`record`, `os.user`, …).
- [x] Migrate the surfaces above to `ExpressionInputSchema`. AI authors then know: **anything templated or computed goes through `Expression`**.

##### M9.9e - Structured rule objects gain Expression escape hatch

These are typed structured objects today, but power users sometimes need a raw CEL fallback. Make each `z.union([structured, ExpressionInputSchema])`:

- [x] `system/audit.zod.ts` `condition`
- [x] `system/metrics.zod.ts` `successCriteria`, `condition`
- [x] `system/tracing.zod.ts` `condition`
- [x] `cloud/marketplace-admin.zod.ts` `criteria`

##### M9.9 — Intentional non-targets (documented for clarity)

These remain non-CEL by design and should NOT be unified:

- **SQL fragments** — `data/analytics.zod.ts` (`sql`), `data/object.zod.ts` (`partial` SQL WHERE). Driver-native; portability story differs.
- **NoSQL filters** — `data/driver-nosql.zod.ts` `partialFilterExpression` (MongoDB JSON).
- **OData / OpenAPI runtime expressions** — `api/odata.zod.ts`, `api/rest-server.zod.ts` `expression` (`{$request.body#/callbackUrl}`). Externally-specified DSLs.
- **Wire query params** — `api/protocol.zod.ts` `filter`/`filters`/`sort`. JSON-encoded ObjectQL on the wire.
- **Structured `FilterCondition`** — `data/data-engine.zod.ts` `where`. Typed object DSL preferred for query planner; CEL escape hatch already exists via `View.criteria` / `Workflow.criteria`.

---

## ⛔ Explicit Non-Goals (Phase 1)

| Item | Reason |
|:---|:---|
| Branch / `sys_branch` / `branch_id` | Deferred. Phase 1 has one current metadata state per project. |
| Branch hostnames, branch diff, branch merge | Deferred with the branch model. |
| Studio metadata editing | Deferred. Studio is read-only for user metadata in Phase 1. |
| Bidirectional CLI ↔ Studio write model | Deferred. Local TS workspace is the only metadata authoring surface in Phase 1. |
| `objectstack pull` JSON -> TS emitter | Deferred until there is a control-plane writer that can change metadata outside local TS. |
| Merge/conflict UX | Deferred. `commitId` identifies revisions and artifacts, not collaborative merge state. |
| Versioning / Release / Tag entity | Deferred. Freezing current metadata into immutable releases comes later. |
| Salesforce-flavor formula compatibility | Deferred / not pursued. The legacy 22-function custom DSL (D9) is replaced by CEL (M9), not extended. Authors targeting Salesforce semantics rewrite in CEL — see north-star §8 anti-pattern "No private DSL". |
| S3 artifact backend | Deferred. Artifact API response shape should allow it later, but backend is control-plane DB now. |

---

## Future Phases

These are intentionally outside Phase 1 but should remain compatible with the Phase 1 model.

### Phase 2 - Studio authoring

- Add visual metadata editors in Studio.
- Route every Studio save through a control-plane metadata write API.
- Introduce optimistic concurrency for CLI ↔ Studio writes.
- Decide whether `objectstack pull` generates canonical TS or attempts source-preserving round trips.

### Phase 3 - Branching and collaboration

- Add `sys_branch` and `branch_id`.
- Migrate the Phase 1 current project metadata state to default branch `main`.
- Evolve partition key from `(organization_id, project_id)` to `(organization_id, project_id, branch_id)`.
- Add branch hostnames, branch diff, branch merge, and conflict UX.

### Phase 4 - Releases and artifact storage

- Add Release / Tag entity.
- Freeze project or branch states into immutable artifacts.
- Add rollback UI.
- Swap Artifact API backend to S3/signed URL where useful.

---

## Dependency Graph (Reading Order for Implementation)

```
M1 Artifact format v0
├── M1.x Runtime Inputs 边界化 (Artifact + Deployment Config 分离)
└── M2 Metadata migration to control plane
    ├── M3 Project Artifact API
    │   └── M4 ObjectOS artifact loader
    └── M5 Project publish endpoint -> resolves D2
        └── M6 Studio metadata/artifact viewer

M7 objectstack dev offline boot  (parallel after M1)
M8 UI auto-generation            (long tail after artifact schema stabilizes)
M9 Expression unification        (parallel; spec-only changes, no Phase-1 prereq)
   ├── M9.1 packages/formula + ExpressionSchema
   ├── M9.2 DX shorthand (cel`…`, F`…`, P`…`) + compile normalization
   ├── M9.3 Replace ~25 z.string() expression fields → resolves D10
   ├── M9.4 Dataset SeedValue + SeedLoader expression eval → resolves D11
   ├── M9.5 Delete packages/objectql/src/formula.ts → resolves D9
   ├── M9.6 Migrate examples/app-crm + byte-identical-build CI gate
   ├── M9.7 AI structured-output (publish JSON Schema + skill doc)
   └── M9.8 Studio visual editor   (after M6)
D3 remove env_id                 (after M2 ownership columns exist)
D8 split apps/cloud + apps/objectos(after M3/M4 make ObjectOS standalone)
D9 / D10 / D11                   (resolved through M9 sub-tasks above)
```

---

## M10 — CRM Production-Readiness (App-Layer + Platform Gaps)

> Derived from the 2026-05-18 real-customer audit of `examples/app-crm`.
> Full report: `~/.copilot/session-state/.../files/production-readiness-assessment.md`.
> Goal: take the CRM example from "single-user demo" to "5-20 person sales team pilot".

### M10 P0 — Blockers (must-have for any paying customer)

- [x] **M10.1 — Audit / Activity auto-writers.** `plugin-audit` registers `sys_audit_log` but never writes; `sys_activity` and `sys_comment` likewise empty after CRUD. Subscribe to ObjectQL `data:*` events from `EventBus` and emit immutable audit rows + human-readable activity entries with field-level diffs. Anchor: [packages/plugins/plugin-audit/src/audit-plugin.ts](packages/plugins/plugin-audit/src/audit-plugin.ts).
- [x] **M10.2 — User invite + default roles.** No `/api/v1/admin/users/invite` endpoint exists. Wrap better-auth `organization.inviteMember` as a first-class REST route. Seed three default roles into `sys_role` (`admin`, `sales_manager`, `sales_rep`). Anchor: [packages/plugins/plugin-auth/](packages/plugins/plugin-auth/).
- [x] **M10.3 — Attachments.** No `sys_attachment` object, no upload component. Register the schema in `packages/spec/src/system/`, wire it to `service-storage`, add an `AttachmentList` view widget. P0 because every CRM contract/quote/PDF is currently un-storable.
- [x] **M10.4 — Validation envelope + Zod-at-rest.** Currently a malformed POST returns raw SQL text. Wrap REST handlers with a structured error envelope (`{code,message,fields[]}`) and run the canonical Zod schema inside ObjectQL `insert/update` before touching the driver. Anchors: [packages/rest/src/rest-server.ts](packages/rest/src/rest-server.ts), [packages/objectql/](packages/objectql/).
- [x] **M10.5 — Global search.** Header already shows `⌘K` but it is inert. Add `GET /api/v1/search?q=` (driver-side `LIKE` across registered searchable fields; FTS later) and wire the Studio command palette to it.

### M10 P1 — Critical (80%+ of customers need these)

- [x] M10.6 — `POST /api/v1/data/lead/:id/convert` → Lead → Account + Contact + Opportunity (compensating rollback; true tx is M11 follow-up).
- [ ] M10.7 — `service-email` + `sys_email` (IMAP/SMTP, OAuth Gmail/Outlook), thread linking to records. **Deferred to M11** — requires external infra outside the first-wave pilot scope.
- [x] M10.8 — `sys_notification` inbox + assignment / @mention writers + header bell (polling). WebSocket push deferred to M11.
- [x] M10.9 — `POST /api/v1/data/:obj/import` CSV/JSON parser with dry-run + field mapping.
- [x] M10.10 — Comments / @mentions UI on detail pages (sys_comment snake_case fix + reactions writeback).
- [x] M10.11 — Activity-timeline component (consumes M10.1 data via sys_activity → FeedItem mapping).
- [x] M10.12 — `full_name` CEL formula bug (leading space when `salutation` is null).
- [x] M10.13 — Date / datetime column formatters in grid plugin.
- [x] M10.14 — Stop SQL error leakage in REST error responses (centralized sendError → mapDataError).

### M10 P2 — Important (50%+ of customers need these)

- [x] M10.15 — Workflow / approval engine — delivered as M11.C15 (`@objectstack/plugin-approvals` + `sys_approval_process` / `sys_approval_request` / `sys_approval_action`, tenant-scoped REST surface, autopilot lifecycle hooks).
- [x] M10.16 — Saved reports + scheduled email — delivered as M11.C16 (`@objectstack/plugin-reports` + matrix `groupBy` with `dateGranularity`).
- [ ] M10.17 — Record-level sharing rules (`sys_sharing_rule`) + team hierarchy (`sys_team`).
- [ ] M10.18 — Tags (`sys_tag`).
- [ ] M10.19 — Re-enable GraphQL (currently 501) and OpenAPI spec endpoint (currently 404).
- [ ] M10.20 — Realtime channels (collaborative editing on the same opportunity).
- [ ] M10.21 — Outbound webhooks + CSV export.
- [ ] M10.22 — Mobile-optimized layouts (kanban + grid).
- [ ] M10.23 — i18n review for CRM business terms (pipeline / forecast / SLA).

### M10 P3 — Polish

- [ ] M10.24 — Soft delete + recycle bin.
- [ ] M10.25 — Dark-mode visual parity audit.
- [ ] M10.26 — WCAG 2.1 AA accessibility audit.
- [ ] M10.27 — 10K+ record performance (virtual scrolling, indices).

---

## Related Documents

| Document | Role |
|:---|:---|
| [content/docs/concepts/north-star.mdx](content/docs/concepts/north-star.mdx) | Authoritative spec - §1 tenets, §3 surfaces, §5 architecture, §7 ledger, §9 open questions |
| [CLAUDE.md](CLAUDE.md) | Dev conventions - Zod-first, naming, kernel standards |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | Mirror of CLAUDE.md for Copilot |
| [packages/cli/src/commands/compile.ts](packages/cli/src/commands/compile.ts) | TS -> JSON compile (Built anchor) |
| [packages/cli/src/commands/publish.ts](packages/cli/src/commands/publish.ts) | Publish command (Drift D2 target) |
| [packages/metadata/src/plugin.ts](packages/metadata/src/plugin.ts) | MetadataPlugin (artifact/local-file metadata loader; D1 resolved anchor) |
