# @objectstack/runtime

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
  - @objectstack/plugin-security@5.2.0
  - @objectstack/rest@5.2.0
  - @objectstack/plugin-auth@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0
  - @objectstack/observability@5.2.0
  - @objectstack/service-cluster@5.1.1
  - @objectstack/service-i18n@5.2.0
  - @objectstack/types@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0
  - @objectstack/observability@5.1.0
  - @objectstack/plugin-auth@5.1.0
  - @objectstack/plugin-security@5.1.0
  - @objectstack/rest@5.1.0
  - @objectstack/service-i18n@5.1.0
  - @objectstack/types@5.1.0

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

### Patch Changes

- 96ad4df: Fix dev-mode HMR data-reload for `*.view.ts` / `*.flow.ts` source-file edits.

  Three coordinated fixes close the long-standing gap where editing a
  declarative-metadata source file in dev (e.g. `case.view.ts`) would
  recompile `dist/objectstack.json` but the running server kept serving
  the stale boot-time value:

  1. **`@objectstack/objectql`** — `ObjectStackProtocolImplementation.getMetaItem`
     now consults `MetadataService` (HMR-aware) **before** the in-memory
     `SchemaRegistry` (boot-time cache). Previously the registry shadowed
     freshly-registered values: `manager.register('view','case',newDef)`
     updated MetadataManager but `getMetaItem` returned the stale registry
     copy because step 2 (registry) ran before step 3 (service). Reordered
     to "1. sys_metadata overlay → 2. MetadataService → 3. SchemaRegistry".

  2. **`@objectstack/runtime`** — `createStandaloneStack` now enables the
     `MetadataPlugin` artifact-file watcher in non-production environments
     (`NODE_ENV !== 'production'`). Previously hard-coded to `watch: false`,
     leaving nothing watching `dist/objectstack.json` when the CLI dev mode
     recompiled it.

  3. **`@objectstack/metadata`** & **`@objectstack/metadata-fs`** — Both
     chokidar watchers now use `usePolling: true` to avoid `fs.watch`
     EMFILE on macOS / busy dev hosts where the native file-descriptor
     pool can be exhausted by other long-running node processes.

  With these three changes:

  - CLI edits source → recompile artifact (~400ms)
  - Server's polling chokidar detects artifact change → `_loadFromLocalFile`
  - `_loadFromLocalFile` calls `manager.register(type, name, item)`
  - MetadataService now has the fresh value
  - Read path returns the fresh value via the new step-2 lookup
  - Studio SSE listeners re-render

- df18ae9: Fix dev-mode HMR data-reload for view metadata.

  `MetadataPlugin._parseAndRegisterArtifact` previously required a top-level
  `name` on every artifact item and silently skipped those without one.
  View bundles in the compiled artifact carry no top-level `name` (their
  identity is the target object, encoded under `list.data.object` /
  `form.data.object` — same pattern used by `ObjectQL.SchemaRegistry`'s
  `resolveMetadataItemName`). As a result, artifact-loaded views never
  reached `MetadataManager`, and HMR file pushes never affected the read
  path: API responses kept returning the boot-time `SchemaRegistry` copy.

  This change derives the registration key from `list.data.object` (or
  `form.data.object`) when no top-level `name` is present, mirroring the
  ObjectQL convention.

  Also splits the `MetadataPlugin` watch flag into two independent
  options so dev mode can enable artifact-file HMR without paying the
  cost of the source-file scanner:

  - `watch` — controls `NodeMetadataManager`'s recursive source scan
    (default `false`; turning it on in artifact mode would polling-scan
    the entire project root including `node_modules`).
  - `artifactWatch` — controls the cheap single-file polling watcher on
    the compiled artifact (`dist/objectstack.json`). The standalone stack
    enables this automatically when `NODE_ENV !== 'production'`.

- Updated dependencies [5cfdc85]
- Updated dependencies [2f9073a]
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0
  - @objectstack/observability@5.0.0
  - @objectstack/service-i18n@5.0.0
  - @objectstack/types@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/rest@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/plugin-auth@4.2.0
  - @objectstack/plugin-security@4.2.0
  - @objectstack/service-i18n@4.2.0
  - @objectstack/types@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/types@4.1.1
- @objectstack/formula@4.1.1
- @objectstack/rest@4.1.1
- @objectstack/plugin-auth@4.1.1
- @objectstack/plugin-security@4.1.1
- @objectstack/service-i18n@4.1.1

## 4.1.0

### Minor Changes

- 96fb108: Artifact-first boot: `objectstack start` (and `objectstack serve`) now boot directly from a compiled `dist/objectstack.json` when no `objectstack.config.ts` is present.

  - `@objectstack/runtime` exports `createDefaultHostConfig()` and `resolveDefaultArtifactPath()` — a standalone-only default host that wraps `createStandaloneStack()` and surfaces the artifact's `requires` / `objects` / `manifest`. No dependency on `@objectstack/service-cloud`.
  - `objectstack start` accepts `OS_ARTIFACT_PATH` as a file path **or** an `http(s)://` URL. New flags `--artifact`, `--database`, `--database-driver`, `--database-auth-token`, `--auth-secret`, `--project-id`, `--port` let you specify all runtime conditions on the command line (each overrides the matching env var).
  - `objectstack dev` accepts the same runtime-override flags. When `--artifact` is supplied, the auto-compile step is skipped and the dev server boots the supplied artifact directly — no `objectstack.config.ts` required in cwd.
  - `objectstack start` no longer mounts Studio / Account / Console by default — those are dev/admin surfaces. Pass `--ui` to opt back in.
  - `objectstack serve` falls back to the default host config when the config file is missing but an artifact is resolvable.
  - `apps/objectos` (cloud / multi-project) is unchanged.

- 70db902: Add production observability primitives. `createDispatcherPlugin` now
  exposes an `observability` config that auto-instruments every mounted
  route with:

  - Request-id propagation: `X-Request-Id` echo + `req.requestId` (honors
    incoming header when well-formed, mints `req_<uuid>` otherwise).
  - `http_requests_total{method,route,status}` counter.
  - `http_request_duration_ms{method,route}` histogram.
  - `http_request_errors_total{method,route}` counter.
  - Error reporter call for 5xx (4xx are intentionally tracked via
    metrics only, not reported, to keep APM signal:noise high).

  All defaults are no-op (zero overhead). Hosts plug their own
  `MetricsRegistry` (Prometheus / OTel) and `ErrorReporter` (Sentry /
  Datadog) — see `docs/OBSERVABILITY.md` for adapter recipes and the
  go-live checklist.

  Standalone primitives also exported for adapter-layer use:
  `extractRequestId`, `resolveRequestId`, `parseTraceparent`,
  `formatTraceparent`, `InMemoryMetricsRegistry`,
  `InMemoryErrorReporter`, `instrumentRouteHandler`.

- 70db902: Add production HTTP hardening primitives. `createDispatcherPlugin` now
  sends conservative security response headers by default
  (CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy /
  Permissions-Policy / Cross-Origin-Resource-Policy). HSTS is opt-in.

  Caller can disable with `securityHeaders: false` (e.g., when an upstream
  reverse proxy already injects them) or customize per-header via
  `SecurityHeadersOptions`.

  Also exports a standalone token-bucket `RateLimiter` with a pluggable
  `RateLimitStore` interface (in-memory default; trivially backed by
  Redis) and curated `DEFAULT_RATE_LIMITS` for auth / write / read buckets.
  The limiter is NOT auto-wired into the dispatcher — adapter-layer
  wire-up (Fastify / Hono / Express) is recommended for proper IP/key
  extraction; see `docs/HARDENING.md` for recipes.

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [d3b455f]
  - @objectstack/spec@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/rest@4.1.0
  - @objectstack/service-i18n@4.1.0
  - @objectstack/types@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/types@4.0.5
  - @objectstack/formula@4.0.5
  - @objectstack/rest@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/types@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/types@4.0.3
- @objectstack/rest@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/types@4.0.2

## 4.0.0

### Patch Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/rest@4.0.0
  - @objectstack/types@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/types@3.3.1
- @objectstack/rest@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/types@3.3.0
- @objectstack/rest@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9
- @objectstack/types@3.2.9
- @objectstack/rest@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/types@3.2.8
- @objectstack/rest@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/types@3.2.7
- @objectstack/rest@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/types@3.2.6
- @objectstack/rest@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/types@3.2.5
- @objectstack/rest@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/types@3.2.4
- @objectstack/rest@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/types@3.2.3
- @objectstack/rest@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/types@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/types@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/types@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/types@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/types@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/types@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/types@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/types@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/types@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/types@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/types@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/types@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/types@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/types@3.0.3
  - @objectstack/rest@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/types@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/types@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/types@3.0.0
  - @objectstack/rest@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/types@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/types@2.0.6
  - @objectstack/rest@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/rest@2.0.5
  - @objectstack/types@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/types@2.0.4
  - @objectstack/rest@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/types@2.0.3
  - @objectstack/rest@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/rest@2.0.2
  - @objectstack/types@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/types@2.0.1
  - @objectstack/rest@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/rest@2.0.0
  - @objectstack/types@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/types@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/types@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10
  - @objectstack/types@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9
- @objectstack/core@1.0.9
- @objectstack/types@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8
- @objectstack/types@1.0.8

## 1.0.7

### Patch Changes

- ebdf787: feat: implement standard service discovery via `/.well-known/objectstack`
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7
  - @objectstack/types@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/types@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- 877b864: fix: add SPA fallback to hono, fix msw context binding, improve runtime resilience, and fix client-react build types
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/types@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4
- @objectstack/core@1.0.4
- @objectstack/types@1.0.4

## 1.0.3

### Patch Changes

- fb2eabd: fix: resolve "process is not defined" runtime error in browser environments by adding safe environment detection and polyfills
- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3
  - @objectstack/types@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/types@1.0.2

## 1.0.1

### Patch Changes

- Fix TypeScript error in http-dispatcher tests to resolve CI build failures.
  - @objectstack/spec@1.0.1
  - @objectstack/core@1.0.1
  - @objectstack/types@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/types@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/types@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/types@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1
- @objectstack/types@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/types@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/objectql@0.6.0
  - @objectstack/types@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2
  - @objectstack/objectql@0.4.2
  - @objectstack/types@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1
  - @objectstack/types@0.4.1
  - @objectstack/objectql@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3
  - @objectstack/objectql@0.3.3
  - @objectstack/types@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/objectql@0.3.2
  - @objectstack/spec@0.3.2
  - @objectstack/types@0.3.2

## 0.3.1

### Patch Changes

- Organize zod schema files by folder structure and improve project documentation
  - @objectstack/spec@0.3.1
  - @objectstack/objectql@0.3.1
  - @objectstack/types@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/types@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0
  - @objectstack/types@0.2.0
  - @objectstack/objectql@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
  - @objectstack/objectql@0.1.1
  - @objectstack/types@0.1.1
