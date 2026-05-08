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
| Per-project ObjectKernel with LRU cache | [packages/runtime/src/project-kernel-factory.ts](packages/runtime/src/project-kernel-factory.ts) |
| Hostname-based routing: `sys_project.hostname` -> kernel resolution | [packages/runtime/src/environment-registry.ts](packages/runtime/src/environment-registry.ts) |
| `ControlPlaneProxyDriver` - org-scoped data isolation | [packages/runtime/src/control-plane-proxy-driver.ts](packages/runtime/src/control-plane-proxy-driver.ts) |
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

#### M9.1 - `packages/formula` package + ExpressionSchema

- [ ] New `packages/formula/` with `cel-js` integration.
- [ ] ObjectStack CEL stdlib: `os.now()`, `os.today()`, `os.daysFromNow(n)`, `os.user.*`, `os.org.*`, `os.env`, `os.exists(obj, predicate)`, `os.count(obj, predicate)`, `os.lookup(obj, id)`, `record.*`, `previous.*`, `input.*`.
- [ ] `packages/spec/src/shared/expression.zod.ts` exports `ExpressionDialect`, `CelExprSchema`, `ExpressionSchema`.
- [ ] `ExpressionEngine` registry with `evaluate(expr, ctx)` single entrypoint.

**Prerequisite for:** M9.2–M9.6.

#### M9.2 - DX shorthand (build-time only)

- [ ] `cel\`...\``, `F\`...\`` (formula), `P\`...\`` (predicate) tagged-template helpers exported from `@objectstack/spec`.
- [ ] `objectstack compile` normalizes any `source` string in input metadata into `ast`. **Persisted artifact contains AST only — no source strings.**

#### M9.3 - Replace scattered `z.string()` expression fields

- [ ] Audit and migrate all ~25 fields listed in D10 to `ExpressionSchema` (input accepts `string | Expression` for back-compat; output is `Expression`).
- [ ] Update generated JSON Schemas; regenerate `content/docs/references/`.

**Resolves:** D10.

#### M9.4 - Seed dynamic values

- [ ] `Dataset.records` accepts `SeedValue = primitive | Expression | nested`.
- [ ] `SeedLoader.load()` walks records, calls `ExpressionEngine.evaluate('cel', ast, seedCtx)` before write. `seedCtx` exposes `os.now / os.user / os.org / os.env` from the install environment, with a single snapshotted `now` per load run for determinism.

**Resolves:** D11.

#### M9.5 - Delete custom formula engine

- [ ] `packages/objectql/src/engine.ts` (computed fields) and `packages/objectql/src/hook-wrappers.ts` (hook conditions) call `ExpressionEngine.evaluate` instead of `evaluateFormula`.
- [ ] **Delete** [packages/objectql/src/formula.ts](packages/objectql/src/formula.ts) and [packages/spec/docs/formula-functions.md](packages/spec/docs/formula-functions.md).

**Resolves:** D9.

#### M9.6 - Migrate `examples/app-crm`

- [ ] Re-write all CRM example formulas, conditions, criteria, and seed dates in CEL.
- [ ] CI gate: run `objectstack build` twice in succession; assert `dist/objectstack.json` is byte-identical (sha256 match). This locks in deterministic builds going forward.

#### M9.7 - AI structured-output integration

- [ ] Publish `CelExprSchema` as JSON Schema for AI constrained decoding.
- [ ] New `skills/objectstack-formula/SKILL.md` mandating "AI agents MUST emit AST, not source strings."
- [ ] Wire structured-output prompts into Studio AI assistant + CLI scaffolding.

#### M9.8 - Studio visual expression editor

- [ ] Node-graph editor backed directly by `CelExprSchema`. No string parser needed in Studio. Deferred — depends on M6.

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

## Related Documents

| Document | Role |
|:---|:---|
| [content/docs/concepts/north-star.mdx](content/docs/concepts/north-star.mdx) | Authoritative spec - §1 tenets, §3 surfaces, §5 architecture, §7 ledger, §9 open questions |
| [CLAUDE.md](CLAUDE.md) | Dev conventions - Zod-first, naming, kernel standards |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | Mirror of CLAUDE.md for Copilot |
| [packages/cli/src/commands/compile.ts](packages/cli/src/commands/compile.ts) | TS -> JSON compile (Built anchor) |
| [packages/cli/src/commands/publish.ts](packages/cli/src/commands/publish.ts) | Publish command (Drift D2 target) |
| [packages/metadata/src/plugin.ts](packages/metadata/src/plugin.ts) | MetadataPlugin (artifact/local-file metadata loader; D1 resolved anchor) |
