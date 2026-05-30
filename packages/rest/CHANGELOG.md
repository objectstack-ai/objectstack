# @objectstack/rest

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/service-package@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/service-package@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/service-package@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-package@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/service-package@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/service-package@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/service-package@6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-package@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/service-package@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-package@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/service-package@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/service-package@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/service-package@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/service-package@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/service-package@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/service-package@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/service-package@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/service-package@6.1.0

## 6.0.0

### Major Changes

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/service-package@6.0.0

## 5.2.0

### Patch Changes

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/service-package@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/service-package@5.1.0

## 5.0.0

### Minor Changes

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/service-package@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/service-package@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/service-package@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/service-package@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/service-package@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.1.1
  - @objectstack/core@1.1.1

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema, MCP Protocol schemas, API versioning, Dispatcher protocol
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` now use `z.unknown()`. Add type narrowing where needed.

  ### Hub schemas relocated

  Barrel imports via `Hub.*` still work. Direct path imports (`hub/license.zod.ts` → `system/license.zod.ts`) need updating.

  ### MetricType renamed

  `MetricType` (analytics) → `AggregationMetricType`, `MetricType` (licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → `createDispatcherPlugin()`
  - `createHonoApp` → `HonoServerPlugin`

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema (`Studio.PluginManifest`)
  - **@objectstack/spec**: MCP (Model Context Protocol) schemas for AI tools, resources, prompts, transport
  - **@objectstack/spec**: API versioning schema with multiple strategies
  - **@objectstack/spec**: Dispatcher protocol schema
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas for JSON Schema generation
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  REST API is now opt-in. If you relied on automatic REST registration:

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` in spec schemas changed from `z.any()` to `z.unknown()`. If you consume inferred types, add type narrowing:

  ```ts
  // Before — worked silently
  const val: string = record.metadata.foo;

  // After — requires narrowing
  const meta = record.metadata as Record<string, string>;
  const val = meta.foo;
  ```

  ### Hub schemas relocated

  - `hub/composer.zod.ts`, `hub/marketplace.zod.ts`, `hub/space.zod.ts`, `hub/hub-federation.zod.ts` — removed
  - `hub/plugin-registry.zod.ts` → `kernel/plugin-registry.zod.ts`
  - `hub/license.zod.ts` → `system/license.zod.ts`
  - `hub/tenant.zod.ts` → `system/tenant.zod.ts`

  Barrel imports via `Hub.*` namespace still work. Direct path imports need updating.

  ### MetricType renamed

  - `MetricType` (data analytics) → `AggregationMetricType`
  - `MetricType` (hub licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → use `createDispatcherPlugin()` instead
  - `createHonoApp` → use `HonoServerPlugin` instead

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
