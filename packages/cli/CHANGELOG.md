# @objectstack/cli

## 6.9.0

### Patch Changes

- Updated dependencies [bac7ae5]
- Updated dependencies [e9bacda]
  - @objectstack/runtime@6.9.0
  - @objectstack/service-ai@6.9.0
  - @objectstack/service-settings@6.9.0
  - @objectstack/client@6.9.0
  - @objectstack/spec@6.9.0
  - @objectstack/core@6.9.0
  - @objectstack/objectql@6.9.0
  - @objectstack/observability@6.9.0
  - @objectstack/rest@6.9.0
  - @objectstack/driver-memory@6.9.0
  - @objectstack/driver-sql@6.9.0
  - @objectstack/driver-mongodb@6.9.0
  - @objectstack/driver-sqlite-wasm@6.9.0
  - @objectstack/plugin-approvals@6.9.0
  - @objectstack/plugin-audit@6.9.0
  - @objectstack/plugin-auth@6.9.0
  - @objectstack/plugin-email@6.9.0
  - @objectstack/plugin-hono-server@6.9.0
  - @objectstack/plugin-mcp-server@6.9.0
  - @objectstack/plugin-reports@6.9.0
  - @objectstack/plugin-security@6.9.0
  - @objectstack/plugin-sharing@6.9.0
  - @objectstack/plugin-webhooks@6.9.0
  - @objectstack/service-analytics@6.9.0
  - @objectstack/service-automation@6.9.0
  - @objectstack/service-cache@6.9.0
  - @objectstack/service-feed@6.9.0
  - @objectstack/service-job@6.9.0
  - @objectstack/service-package@6.9.0
  - @objectstack/service-queue@6.9.0
  - @objectstack/service-realtime@6.9.0
  - @objectstack/service-storage@6.9.0
  - @objectstack/account@6.9.0

## 6.8.1

### Patch Changes

- bca0ee5: `os dev` and `os start` now load `.env` files via dotenv-flow, matching
  the existing `os serve` behavior. Previously only `serve` honored
  `.env` / `.env.development` / `.env.production` / `.env.local`, which
  made env-based configuration (e.g. `OS_DATABASE_URL`) silently inert
  for the two most commonly used commands and surprised users who set up
  the conventional `.env.*` layout.

  Loading order (later wins): `.env`, `.env.${NODE_ENV}`, `.env.local`,
  `.env.${NODE_ENV}.local`. `os dev` pins NODE_ENV to `development`; `os
start` defaults to `production`. Process env still wins over file
  values, so CLI flags and shell exports remain authoritative.

  - @objectstack/spec@6.8.1
  - @objectstack/core@6.8.1
  - @objectstack/client@6.8.1
  - @objectstack/objectql@6.8.1
  - @objectstack/observability@6.8.1
  - @objectstack/runtime@6.8.1
  - @objectstack/rest@6.8.1
  - @objectstack/driver-memory@6.8.1
  - @objectstack/driver-sql@6.8.1
  - @objectstack/driver-mongodb@6.8.1
  - @objectstack/driver-sqlite-wasm@6.8.1
  - @objectstack/plugin-approvals@6.8.1
  - @objectstack/plugin-audit@6.8.1
  - @objectstack/plugin-auth@6.8.1
  - @objectstack/plugin-email@6.8.1
  - @objectstack/plugin-hono-server@6.8.1
  - @objectstack/plugin-mcp-server@6.8.1
  - @objectstack/plugin-reports@6.8.1
  - @objectstack/plugin-security@6.8.1
  - @objectstack/plugin-sharing@6.8.1
  - @objectstack/plugin-webhooks@6.8.1
  - @objectstack/service-ai@6.8.1
  - @objectstack/service-analytics@6.8.1
  - @objectstack/service-automation@6.8.1
  - @objectstack/service-cache@6.8.1
  - @objectstack/service-feed@6.8.1
  - @objectstack/service-job@6.8.1
  - @objectstack/service-package@6.8.1
  - @objectstack/service-queue@6.8.1
  - @objectstack/service-realtime@6.8.1
  - @objectstack/service-settings@6.8.1
  - @objectstack/service-storage@6.8.1
  - @objectstack/account@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [99866d8]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
- Updated dependencies [0a40bd1]
  - @objectstack/service-ai@6.8.0
  - @objectstack/spec@6.8.0
  - @objectstack/account@6.8.0
  - @objectstack/rest@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/runtime@6.8.0
  - @objectstack/service-settings@6.8.0
  - @objectstack/client@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/observability@6.8.0
  - @objectstack/driver-memory@6.8.0
  - @objectstack/driver-mongodb@6.8.0
  - @objectstack/driver-sql@6.8.0
  - @objectstack/driver-sqlite-wasm@6.8.0
  - @objectstack/plugin-approvals@6.8.0
  - @objectstack/plugin-audit@6.8.0
  - @objectstack/plugin-auth@6.8.0
  - @objectstack/plugin-email@6.8.0
  - @objectstack/plugin-hono-server@6.8.0
  - @objectstack/plugin-mcp-server@6.8.0
  - @objectstack/plugin-reports@6.8.0
  - @objectstack/plugin-security@6.8.0
  - @objectstack/plugin-sharing@6.8.0
  - @objectstack/plugin-webhooks@6.8.0
  - @objectstack/service-analytics@6.8.0
  - @objectstack/service-automation@6.8.0
  - @objectstack/service-cache@6.8.0
  - @objectstack/service-feed@6.8.0
  - @objectstack/service-job@6.8.0
  - @objectstack/service-package@6.8.0
  - @objectstack/service-queue@6.8.0
  - @objectstack/service-realtime@6.8.0
  - @objectstack/service-storage@6.8.0

## 6.7.1

### Patch Changes

- 3b2a1da: Add `@objectstack/account` as a direct dependency of `@objectstack/cli`.

  **Bug**: `npx @objectstack/cli start` started the server successfully but visiting `http://localhost:3000/` produced a raw `{"error":"Not found"}` JSON response. Root cause: the Console SPA redirects unauthenticated users to `/_account/login` (hardcoded in the published Console bundle), but the `@objectstack/account` package was never declared as a CLI dependency. The start log even printed `⚠ @objectstack/account not found — skipping Account UI`, yet the Console kept pointing browsers at the missing mount.

  **Fix**: declare `@objectstack/account` in `packages/cli/package.json` so `npm install @objectstack/cli` pulls the account portal automatically. Verified end-to-end in a clean `/tmp/test-670-patched` install:

  - `npm ls @objectstack/account` → installed
  - `/_account/login` → 200 (was 404)
  - Navigating to `/` correctly routes through Console → Account `/setup` (the first-run owner-account wizard) instead of dead-ending in the API catch-all.

  No change to `@libsql/client` posture — it remains absent from default installs.

- Updated dependencies [87c4d19]
  - @objectstack/account@6.7.1
  - @objectstack/spec@6.7.1
  - @objectstack/core@6.7.1
  - @objectstack/client@6.7.1
  - @objectstack/objectql@6.7.1
  - @objectstack/observability@6.7.1
  - @objectstack/runtime@6.7.1
  - @objectstack/rest@6.7.1
  - @objectstack/driver-memory@6.7.1
  - @objectstack/driver-sql@6.7.1
  - @objectstack/driver-mongodb@6.7.1
  - @objectstack/driver-sqlite-wasm@6.7.1
  - @objectstack/plugin-approvals@6.7.1
  - @objectstack/plugin-audit@6.7.1
  - @objectstack/plugin-auth@6.7.1
  - @objectstack/plugin-email@6.7.1
  - @objectstack/plugin-hono-server@6.7.1
  - @objectstack/plugin-mcp-server@6.7.1
  - @objectstack/plugin-reports@6.7.1
  - @objectstack/plugin-security@6.7.1
  - @objectstack/plugin-sharing@6.7.1
  - @objectstack/plugin-webhooks@6.7.1
  - @objectstack/service-ai@6.7.1
  - @objectstack/service-analytics@6.7.1
  - @objectstack/service-automation@6.7.1
  - @objectstack/service-cache@6.7.1
  - @objectstack/service-feed@6.7.1
  - @objectstack/service-job@6.7.1
  - @objectstack/service-package@6.7.1
  - @objectstack/service-queue@6.7.1
  - @objectstack/service-realtime@6.7.1
  - @objectstack/service-settings@6.7.1
  - @objectstack/service-storage@6.7.1

## 6.7.0

### Patch Changes

- c5efe15: Remove residual coupling to the (already-extracted) `@objectstack/service-cloud` package.

  The cloud distribution was migrated to a separate repo a while back, but the open-core CLI still carried:

  - A dynamic `import('@objectstack/service-cloud')` in the boot-mode dispatch for `cloud` / `runtime` modes.
  - A dev-mode auto-mount that tried to load `createSingleEnvironmentPlugin` from the cloud package (now fully covered by the built-in `RuntimeConfigPlugin`).
  - An ambient `.d.ts` stub for `@objectstack/service-cloud`.
  - A leftover empty `packages/services/service-cloud/` directory (only stale `dist/` + `node_modules/`).
  - Several doc-comment references.

  All gone. The open-core CLI now supports `bootMode: 'standalone'` only — non-standalone modes throw a clear error pointing users to the cloud distribution. No runtime behavior change for standalone users.

- 4944f3a: Fix `npx @objectstack/cli start` crashing with `Cannot find package
'@objectstack/metadata'` (and friends).

  `@objectstack/runtime` dynamically `import()`s `@objectstack/metadata`,
  `@objectstack/objectql`, and the storage drivers (`driver-memory`,
  `driver-sql`, `driver-sqlite-wasm`, `driver-turso`) from
  `createStandaloneStack` / `createDefaultHostConfig`, but they were only
  listed in `devDependencies` — so when the package was installed from npm
  (rather than the workspace) these imports failed at boot.

  They are now declared as real `dependencies`. `@objectstack/driver-mongodb`
  remains an `optionalDependency` because the standalone stack only loads
  it when the user passes a `mongodb://` URL (the failure path already has
  a friendly error message).

  Also adds a small quick-start CLI command (`objectstack start`) that
  auto-creates `~/.objectstack/{data,dist,auth-secret}`, boots an empty
  kernel with Studio + marketplace mounted, and lets users install apps at
  runtime — no `objectstack.config.ts` required.

- e0c593f: Make `@objectstack/driver-turso` an **optional peer dependency** so default `npx @objectstack/cli start` no longer installs `@libsql/client` (~5MB + native binaries) nor `libsql` native modules.

  Rationale: `objectstack start` defaults to `file:` URLs which route to `better-sqlite3` via `driver-sql` (10–15× faster than libsql for OLTP, see benchmarks). For RAG / vector workloads, `sqlite-vec` (~600KB) is the recommended local backend. Turso / libsql is only useful when the user explicitly opts in via `libsql://` / `https://` / `--database-driver turso`.

  Changes:

  - `packages/cli/package.json`: moved `@objectstack/driver-turso` from `dependencies` to optional `peerDependencies` (`peerDependenciesMeta.optional = true`). npm 7+ does **not** auto-install optional peers; `optionalDependencies` would have still installed it.
  - `packages/runtime/package.json`: same.
  - All three dynamic-import sites for `driver-turso` (`runtime/src/standalone-stack.ts`, `runtime/src/cloud/artifact-environment-registry.ts`, `cli/src/commands/serve.ts`) now wrap the `import()` in try/catch with an actionable error message pointing users to `npm install @objectstack/driver-turso`.

  Verified in `/tmp/os-sim`: fresh `npm install @objectstack/cli` no longer contains `node_modules/@libsql`, `node_modules/libsql`, or `node_modules/@objectstack/driver-turso`. `objectstack start` boots cleanly with better-sqlite3; `--database libsql://…` produces the friendly error.

- Updated dependencies [4944f3a]
- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [4f9e9d4]
- Updated dependencies [e0c593f]
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/service-ai@6.7.0
  - @objectstack/runtime@6.7.0
  - @objectstack/service-settings@6.7.0
  - @objectstack/driver-sqlite-wasm@6.7.0
  - @objectstack/client@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/objectql@6.7.0
  - @objectstack/observability@6.7.0
  - @objectstack/driver-memory@6.7.0
  - @objectstack/driver-mongodb@6.7.0
  - @objectstack/plugin-approvals@6.7.0
  - @objectstack/plugin-audit@6.7.0
  - @objectstack/plugin-auth@6.7.0
  - @objectstack/plugin-email@6.7.0
  - @objectstack/plugin-hono-server@6.7.0
  - @objectstack/plugin-mcp-server@6.7.0
  - @objectstack/plugin-reports@6.7.0
  - @objectstack/plugin-security@6.7.0
  - @objectstack/plugin-sharing@6.7.0
  - @objectstack/plugin-webhooks@6.7.0
  - @objectstack/rest@6.7.0
  - @objectstack/service-analytics@6.7.0
  - @objectstack/service-automation@6.7.0
  - @objectstack/service-cache@6.7.0
  - @objectstack/service-feed@6.7.0
  - @objectstack/service-job@6.7.0
  - @objectstack/service-package@6.7.0
  - @objectstack/service-queue@6.7.0
  - @objectstack/service-realtime@6.7.0
  - @objectstack/service-storage@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/client@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/observability@6.6.0
  - @objectstack/driver-memory@6.6.0
  - @objectstack/driver-mongodb@6.6.0
  - @objectstack/driver-sql@6.6.0
  - @objectstack/driver-sqlite-wasm@6.6.0
  - @objectstack/driver-turso@6.6.0
  - @objectstack/plugin-approvals@6.6.0
  - @objectstack/plugin-audit@6.6.0
  - @objectstack/plugin-auth@6.6.0
  - @objectstack/plugin-email@6.6.0
  - @objectstack/plugin-hono-server@6.6.0
  - @objectstack/plugin-mcp-server@6.6.0
  - @objectstack/plugin-reports@6.6.0
  - @objectstack/plugin-security@6.6.0
  - @objectstack/plugin-sharing@6.6.0
  - @objectstack/plugin-webhooks@6.6.0
  - @objectstack/rest@6.6.0
  - @objectstack/runtime@6.6.0
  - @objectstack/service-ai@6.6.0
  - @objectstack/service-analytics@6.6.0
  - @objectstack/service-automation@6.6.0
  - @objectstack/service-cache@6.6.0
  - @objectstack/service-feed@6.6.0
  - @objectstack/service-job@6.6.0
  - @objectstack/service-package@6.6.0
  - @objectstack/service-queue@6.6.0
  - @objectstack/service-realtime@6.6.0
  - @objectstack/service-settings@6.6.0
  - @objectstack/service-storage@6.6.0

## 6.5.1

### Patch Changes

- Updated dependencies [de239ef]
  - @objectstack/plugin-auth@6.5.1
  - @objectstack/runtime@6.5.1
  - @objectstack/client@6.5.1
  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/objectql@6.5.1
  - @objectstack/observability@6.5.1
  - @objectstack/rest@6.5.1
  - @objectstack/driver-memory@6.5.1
  - @objectstack/driver-sql@6.5.1
  - @objectstack/driver-turso@6.5.1
  - @objectstack/driver-mongodb@6.5.1
  - @objectstack/driver-sqlite-wasm@6.5.1
  - @objectstack/plugin-approvals@6.5.1
  - @objectstack/plugin-audit@6.5.1
  - @objectstack/plugin-email@6.5.1
  - @objectstack/plugin-hono-server@6.5.1
  - @objectstack/plugin-mcp-server@6.5.1
  - @objectstack/plugin-reports@6.5.1
  - @objectstack/plugin-security@6.5.1
  - @objectstack/plugin-sharing@6.5.1
  - @objectstack/plugin-webhooks@6.5.1
  - @objectstack/service-ai@6.5.1
  - @objectstack/service-analytics@6.5.1
  - @objectstack/service-automation@6.5.1
  - @objectstack/service-cache@6.5.1
  - @objectstack/service-feed@6.5.1
  - @objectstack/service-job@6.5.1
  - @objectstack/service-package@6.5.1
  - @objectstack/service-queue@6.5.1
  - @objectstack/service-realtime@6.5.1
  - @objectstack/service-settings@6.5.1
  - @objectstack/service-storage@6.5.1

## 6.5.0

### Minor Changes

- 777afbf: Include `ai` in the `default` tier preset so `AIServicePlugin` is auto-registered for every stack that opts into the default tier (i.e. any `defineStack` that doesn't override `requires`). Previously AI routes (`/api/v1/ai/*`) only mounted when a stack explicitly listed `'ai'` in `requires` or ran the `full` preset; now they're on by default, matching `i18n`/`ui`/`auth`. The auto-registration block already fails silently if `@objectstack/service-ai` isn't installed, so apps without the package are unaffected.

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/client@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/observability@6.5.0
- @objectstack/runtime@6.5.0
- @objectstack/rest@6.5.0
- @objectstack/driver-memory@6.5.0
- @objectstack/driver-sql@6.5.0
- @objectstack/driver-turso@6.5.0
- @objectstack/driver-mongodb@6.5.0
- @objectstack/driver-sqlite-wasm@6.5.0
- @objectstack/plugin-approvals@6.5.0
- @objectstack/plugin-audit@6.5.0
- @objectstack/plugin-auth@6.5.0
- @objectstack/plugin-email@6.5.0
- @objectstack/plugin-hono-server@6.5.0
- @objectstack/plugin-mcp-server@6.5.0
- @objectstack/plugin-reports@6.5.0
- @objectstack/plugin-security@6.5.0
- @objectstack/plugin-sharing@6.5.0
- @objectstack/plugin-webhooks@6.5.0
- @objectstack/service-ai@6.5.0
- @objectstack/service-analytics@6.5.0
- @objectstack/service-automation@6.5.0
- @objectstack/service-cache@6.5.0
- @objectstack/service-feed@6.5.0
- @objectstack/service-job@6.5.0
- @objectstack/service-package@6.5.0
- @objectstack/service-queue@6.5.0
- @objectstack/service-realtime@6.5.0
- @objectstack/service-settings@6.5.0
- @objectstack/service-storage@6.5.0

## 6.4.0

### Minor Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

### Patch Changes

- Updated dependencies [a981d57]
- Updated dependencies [b486666]
- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
- Updated dependencies [0bf6f9a]
  - @objectstack/service-ai@6.4.0
  - @objectstack/spec@6.4.0
  - @objectstack/plugin-auth@6.4.0
  - @objectstack/client@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/observability@6.4.0
  - @objectstack/driver-memory@6.4.0
  - @objectstack/driver-mongodb@6.4.0
  - @objectstack/driver-sql@6.4.0
  - @objectstack/driver-sqlite-wasm@6.4.0
  - @objectstack/driver-turso@6.4.0
  - @objectstack/plugin-approvals@6.4.0
  - @objectstack/plugin-audit@6.4.0
  - @objectstack/plugin-email@6.4.0
  - @objectstack/plugin-hono-server@6.4.0
  - @objectstack/plugin-mcp-server@6.4.0
  - @objectstack/plugin-reports@6.4.0
  - @objectstack/plugin-security@6.4.0
  - @objectstack/plugin-sharing@6.4.0
  - @objectstack/plugin-webhooks@6.4.0
  - @objectstack/rest@6.4.0
  - @objectstack/runtime@6.4.0
  - @objectstack/service-analytics@6.4.0
  - @objectstack/service-automation@6.4.0
  - @objectstack/service-cache@6.4.0
  - @objectstack/service-feed@6.4.0
  - @objectstack/service-job@6.4.0
  - @objectstack/service-package@6.4.0
  - @objectstack/service-queue@6.4.0
  - @objectstack/service-realtime@6.4.0
  - @objectstack/service-settings@6.4.0
  - @objectstack/service-storage@6.4.0

## 6.3.0

### Patch Changes

- Updated dependencies [97efe3b]
  - @objectstack/service-settings@6.3.0
  - @objectstack/spec@6.3.0
  - @objectstack/core@6.3.0
  - @objectstack/client@6.3.0
  - @objectstack/objectql@6.3.0
  - @objectstack/observability@6.3.0
  - @objectstack/runtime@6.3.0
  - @objectstack/rest@6.3.0
  - @objectstack/driver-memory@6.3.0
  - @objectstack/driver-sql@6.3.0
  - @objectstack/driver-turso@6.3.0
  - @objectstack/driver-mongodb@6.3.0
  - @objectstack/driver-sqlite-wasm@6.3.0
  - @objectstack/plugin-approvals@6.3.0
  - @objectstack/plugin-audit@6.3.0
  - @objectstack/plugin-auth@6.3.0
  - @objectstack/plugin-email@6.3.0
  - @objectstack/plugin-hono-server@6.3.0
  - @objectstack/plugin-mcp-server@6.3.0
  - @objectstack/plugin-reports@6.3.0
  - @objectstack/plugin-security@6.3.0
  - @objectstack/plugin-sharing@6.3.0
  - @objectstack/plugin-webhooks@6.3.0
  - @objectstack/service-ai@6.3.0
  - @objectstack/service-analytics@6.3.0
  - @objectstack/service-automation@6.3.0
  - @objectstack/service-cache@6.3.0
  - @objectstack/service-feed@6.3.0
  - @objectstack/service-job@6.3.0
  - @objectstack/service-package@6.3.0
  - @objectstack/service-queue@6.3.0
  - @objectstack/service-realtime@6.3.0
  - @objectstack/service-storage@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
- Updated dependencies [13a4f38]
- Updated dependencies [b4c74a9]
- Updated dependencies [bce47a0]
- Updated dependencies [bce47a0]
- Updated dependencies [449e35d]
- Updated dependencies [dbb54e1]
  - @objectstack/plugin-auth@6.2.0
  - @objectstack/service-ai@6.2.0
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0
  - @objectstack/client@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/observability@6.2.0
  - @objectstack/driver-memory@6.2.0
  - @objectstack/driver-mongodb@6.2.0
  - @objectstack/driver-sql@6.2.0
  - @objectstack/driver-sqlite-wasm@6.2.0
  - @objectstack/driver-turso@6.2.0
  - @objectstack/plugin-approvals@6.2.0
  - @objectstack/plugin-audit@6.2.0
  - @objectstack/plugin-email@6.2.0
  - @objectstack/plugin-hono-server@6.2.0
  - @objectstack/plugin-mcp-server@6.2.0
  - @objectstack/plugin-reports@6.2.0
  - @objectstack/plugin-security@6.2.0
  - @objectstack/plugin-sharing@6.2.0
  - @objectstack/plugin-webhooks@6.2.0
  - @objectstack/rest@6.2.0
  - @objectstack/service-analytics@6.2.0
  - @objectstack/service-automation@6.2.0
  - @objectstack/service-cache@6.2.0
  - @objectstack/service-feed@6.2.0
  - @objectstack/service-job@6.2.0
  - @objectstack/service-package@6.2.0
  - @objectstack/service-queue@6.2.0
  - @objectstack/service-realtime@6.2.0
  - @objectstack/service-settings@6.2.0
  - @objectstack/service-storage@6.2.0

## 6.1.1

### Patch Changes

- Updated dependencies [084ee2f]
  - @objectstack/driver-sqlite-wasm@6.1.1
  - @objectstack/runtime@6.1.1
  - @objectstack/spec@6.1.1
  - @objectstack/core@6.1.1
  - @objectstack/client@6.1.1
  - @objectstack/objectql@6.1.1
  - @objectstack/observability@6.1.1
  - @objectstack/rest@6.1.1
  - @objectstack/driver-memory@6.1.1
  - @objectstack/driver-sql@6.1.1
  - @objectstack/driver-turso@6.1.1
  - @objectstack/driver-mongodb@6.1.1
  - @objectstack/plugin-approvals@6.1.1
  - @objectstack/plugin-audit@6.1.1
  - @objectstack/plugin-auth@6.1.1
  - @objectstack/plugin-email@6.1.1
  - @objectstack/plugin-hono-server@6.1.1
  - @objectstack/plugin-mcp-server@6.1.1
  - @objectstack/plugin-reports@6.1.1
  - @objectstack/plugin-security@6.1.1
  - @objectstack/plugin-sharing@6.1.1
  - @objectstack/plugin-webhooks@6.1.1
  - @objectstack/service-ai@6.1.1
  - @objectstack/service-analytics@6.1.1
  - @objectstack/service-automation@6.1.1
  - @objectstack/service-cache@6.1.1
  - @objectstack/service-feed@6.1.1
  - @objectstack/service-job@6.1.1
  - @objectstack/service-package@6.1.1
  - @objectstack/service-queue@6.1.1
  - @objectstack/service-realtime@6.1.1
  - @objectstack/service-settings@6.1.1
  - @objectstack/service-storage@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/service-ai@6.1.0
  - @objectstack/spec@6.1.0
  - @objectstack/client@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/observability@6.1.0
  - @objectstack/driver-memory@6.1.0
  - @objectstack/driver-mongodb@6.1.0
  - @objectstack/driver-sql@6.1.0
  - @objectstack/driver-sqlite-wasm@5.2.2
  - @objectstack/driver-turso@6.1.0
  - @objectstack/plugin-approvals@6.1.0
  - @objectstack/plugin-audit@6.1.0
  - @objectstack/plugin-auth@6.1.0
  - @objectstack/plugin-email@6.1.0
  - @objectstack/plugin-hono-server@6.1.0
  - @objectstack/plugin-mcp-server@6.1.0
  - @objectstack/plugin-reports@6.1.0
  - @objectstack/plugin-security@6.1.0
  - @objectstack/plugin-sharing@6.1.0
  - @objectstack/plugin-webhooks@6.1.0
  - @objectstack/rest@6.1.0
  - @objectstack/runtime@6.1.0
  - @objectstack/service-analytics@6.1.0
  - @objectstack/service-automation@6.1.0
  - @objectstack/service-cache@6.1.0
  - @objectstack/service-feed@6.1.0
  - @objectstack/service-job@6.1.0
  - @objectstack/service-package@6.1.0
  - @objectstack/service-queue@6.1.0
  - @objectstack/service-realtime@6.1.0
  - @objectstack/service-settings@6.1.0
  - @objectstack/service-storage@6.1.0

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
  - @objectstack/service-ai@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/client@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/observability@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/driver-mongodb@6.0.0
  - @objectstack/driver-sql@6.0.0
  - @objectstack/driver-sqlite-wasm@5.2.1
  - @objectstack/driver-turso@6.0.0
  - @objectstack/plugin-approvals@6.0.0
  - @objectstack/plugin-audit@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-email@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-mcp-server@6.0.0
  - @objectstack/plugin-reports@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/plugin-sharing@6.0.0
  - @objectstack/plugin-webhooks@6.0.0
  - @objectstack/service-analytics@6.0.0
  - @objectstack/service-automation@6.0.0
  - @objectstack/service-cache@6.0.0
  - @objectstack/service-feed@6.0.0
  - @objectstack/service-job@6.0.0
  - @objectstack/service-package@6.0.0
  - @objectstack/service-queue@6.0.0
  - @objectstack/service-realtime@6.0.0
  - @objectstack/service-settings@6.0.0
  - @objectstack/service-storage@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/plugin-approvals@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/plugin-security@5.2.0
  - @objectstack/plugin-hono-server@5.2.0
  - @objectstack/rest@5.2.0
  - @objectstack/plugin-audit@5.2.0
  - @objectstack/plugin-auth@5.2.0
  - @objectstack/plugin-email@5.2.0
  - @objectstack/plugin-reports@5.2.0
  - @objectstack/plugin-sharing@5.2.0
  - @objectstack/plugin-webhooks@5.2.0
  - @objectstack/service-ai@5.2.0
  - @objectstack/service-job@5.2.0
  - @objectstack/service-queue@5.2.0
  - @objectstack/service-realtime@5.2.0
  - @objectstack/service-settings@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/objectql@5.2.0
  - @objectstack/observability@5.2.0
  - @objectstack/driver-memory@5.2.0
  - @objectstack/driver-mongodb@5.2.0
  - @objectstack/driver-sql@5.2.0
  - @objectstack/driver-turso@5.2.0
  - @objectstack/plugin-mcp-server@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0
  - @objectstack/service-cache@5.2.0
  - @objectstack/service-feed@5.2.0
  - @objectstack/service-package@5.2.0
  - @objectstack/service-storage@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/driver-memory@5.1.0
  - @objectstack/driver-mongodb@5.1.0
  - @objectstack/driver-sql@5.1.0
  - @objectstack/driver-turso@5.1.0
  - @objectstack/plugin-approvals@5.1.0
  - @objectstack/plugin-audit@5.1.0
  - @objectstack/plugin-auth@5.1.0
  - @objectstack/plugin-email@5.1.0
  - @objectstack/plugin-hono-server@5.1.0
  - @objectstack/plugin-mcp-server@5.1.0
  - @objectstack/plugin-reports@5.1.0
  - @objectstack/plugin-security@5.1.0
  - @objectstack/plugin-sharing@5.1.0
  - @objectstack/rest@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-ai@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0
  - @objectstack/service-cache@5.1.0
  - @objectstack/service-feed@5.1.0
  - @objectstack/service-job@5.1.0
  - @objectstack/service-package@5.1.0
  - @objectstack/service-queue@5.1.0
  - @objectstack/service-realtime@5.1.0
  - @objectstack/service-settings@5.1.0
  - @objectstack/service-storage@5.1.0

## 5.0.0

### Patch Changes

- 9e51868: Server-side artifact-file watcher; CLI no longer posts to the HMR
  endpoint on recompile (ADR-0008 M0 PR-8).

  `MetadataPlugin.start()` now attaches a chokidar watcher on the
  `artifactSource.path` when running in local-file mode with `watch !==
false`. On every artifact change it re-invokes `_loadFromLocalFile`
  and broadcasts a `reload` event through the HMR hub. This replaces
  the previous arrangement where `os dev`'s watch-recompile loop POSTed
  `/api/v1/dev/metadata-events` to trigger a reload — the server is now
  autonomous.

  The CLI `dev` command's recompile loop drops the POST call; the
  `/api/v1/dev/metadata-events` route remains available for external
  trigger sources (cloud webhooks, git hooks, ad-hoc curl).

  `MetadataPlugin.stop()` closes the artifact watcher cleanly.

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/plugin-sharing@5.0.0
  - @objectstack/plugin-approvals@5.0.0
  - @objectstack/plugin-audit@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-email@5.0.0
  - @objectstack/plugin-reports@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/service-ai@5.0.0
  - @objectstack/service-job@5.0.0
  - @objectstack/service-queue@5.0.0
  - @objectstack/service-realtime@5.0.0
  - @objectstack/service-settings@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/driver-mongodb@5.0.0
  - @objectstack/driver-sql@5.0.0
  - @objectstack/driver-turso@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/plugin-mcp-server@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0
  - @objectstack/service-cache@5.0.0
  - @objectstack/service-feed@5.0.0
  - @objectstack/service-package@5.0.0
  - @objectstack/service-storage@5.0.0

## 4.2.0

### Patch Changes

- 3a99239: Metadata HMR via SSE — close the agent-edits → preview-refresh loop.

  - `@objectstack/metadata`: register `/api/v1/dev/metadata-events` SSE endpoint unconditionally;
    add `POST` trigger that reloads the artifact and broadcasts a `reload` event to all listeners.
  - `@objectstack/cli` (`os dev`): chokidar-based watch on `objectstack.config.ts` and `src/`;
    debounced recompile + `POST` to the HMR endpoint so the server reloads without restart.
  - `@objectstack/studio`: `useMetadataHmr` provider opens an `EventSource`, exposes a version
    counter; previews include it in their query deps, and a top-bar badge surfaces connection
    state and event counts for diagnostics.

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/rest@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/driver-memory@4.2.0
  - @objectstack/driver-mongodb@4.2.0
  - @objectstack/driver-sql@4.2.0
  - @objectstack/driver-turso@4.2.0
  - @objectstack/plugin-approvals@4.2.0
  - @objectstack/plugin-audit@4.2.0
  - @objectstack/plugin-auth@4.2.0
  - @objectstack/plugin-email@4.2.0
  - @objectstack/plugin-hono-server@4.2.0
  - @objectstack/plugin-mcp-server@4.2.0
  - @objectstack/plugin-reports@4.2.0
  - @objectstack/plugin-security@4.2.0
  - @objectstack/plugin-sharing@4.2.0
  - @objectstack/service-ai@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0
  - @objectstack/service-cache@4.2.0
  - @objectstack/service-feed@4.2.0
  - @objectstack/service-job@4.2.0
  - @objectstack/service-package@4.2.0
  - @objectstack/service-queue@4.2.0
  - @objectstack/service-realtime@4.2.0
  - @objectstack/service-settings@4.2.0
  - @objectstack/service-storage@4.2.0

## 4.1.1

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/spec@4.1.1
  - @objectstack/core@4.1.1
  - @objectstack/objectql@4.1.1
  - @objectstack/runtime@4.1.1
  - @objectstack/rest@4.1.1
  - @objectstack/driver-memory@4.1.1
  - @objectstack/driver-sql@4.1.1
  - @objectstack/driver-turso@4.1.1
  - @objectstack/driver-mongodb@4.1.1
  - @objectstack/plugin-approvals@4.1.1
  - @objectstack/plugin-audit@4.1.1
  - @objectstack/plugin-auth@4.1.1
  - @objectstack/plugin-email@4.1.1
  - @objectstack/plugin-hono-server@4.1.1
  - @objectstack/plugin-mcp-server@4.1.1
  - @objectstack/plugin-reports@4.1.1
  - @objectstack/plugin-security@4.1.1
  - @objectstack/plugin-sharing@4.1.1
  - @objectstack/service-ai@4.1.1
  - @objectstack/service-analytics@4.1.1
  - @objectstack/service-automation@4.1.1
  - @objectstack/service-cache@4.1.1
  - @objectstack/service-feed@4.1.1
  - @objectstack/service-job@4.1.1
  - @objectstack/service-package@4.1.1
  - @objectstack/service-queue@4.1.1
  - @objectstack/service-realtime@4.1.1
  - @objectstack/service-settings@4.1.1
  - @objectstack/service-storage@4.1.1

## 4.1.0

### Minor Changes

- 96fb108: Artifact-first boot: `objectstack start` (and `objectstack serve`) now boot directly from a compiled `dist/objectstack.json` when no `objectstack.config.ts` is present.

  - `@objectstack/runtime` exports `createDefaultHostConfig()` and `resolveDefaultArtifactPath()` — a standalone-only default host that wraps `createStandaloneStack()` and surfaces the artifact's `requires` / `objects` / `manifest`. No dependency on `@objectstack/service-cloud`.
  - `objectstack start` accepts `OS_ARTIFACT_PATH` as a file path **or** an `http(s)://` URL. New flags `--artifact`, `--database`, `--database-driver`, `--database-auth-token`, `--auth-secret`, `--project-id`, `--port` let you specify all runtime conditions on the command line (each overrides the matching env var).
  - `objectstack dev` accepts the same runtime-override flags. When `--artifact` is supplied, the auto-compile step is skipped and the dev server boots the supplied artifact directly — no `objectstack.config.ts` required in cwd.
  - `objectstack start` no longer mounts Studio / Account / Console by default — those are dev/admin surfaces. Pass `--ui` to opt back in.
  - `objectstack serve` falls back to the default host config when the config file is missing but an artifact is resolvable.
  - `apps/objectos` (cloud / multi-project) is unchanged.

- 8cbc768: CLI no longer hard-depends on `@objectstack/service-cloud`. The control plane
  (`apps/cloud` + `@objectstack/service-cloud`) and tenant runtime (`apps/objectos`)
  have been split into a private companion repo `objectstack-ai/cloud`. Framework
  remains pure open-core.

  User impact:

  - `os serve --mode=cloud` keeps working in cloud-aware distributions — the CLI
    loads `@objectstack/service-cloud` via dynamic `import()` with try/catch and
    surfaces a clear "install the cloud distribution" hint when absent.
  - Root `pnpm dev` / `pnpm start` / `pnpm doctor` scripts in this repo are
    removed (they were thin filters of `@objectstack/objectos`, which no longer
    lives here). For a runnable local stack, use one of the examples
    (`pnpm --filter @example/app-crm dev`).

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
- Updated dependencies [d3b455f]
- Updated dependencies [0cc0374]
- Updated dependencies [5b878d9]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/driver-sql@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/driver-memory@4.1.0
  - @objectstack/driver-mongodb@4.1.0
  - @objectstack/driver-turso@4.1.0
  - @objectstack/plugin-approvals@4.0.1
  - @objectstack/plugin-audit@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/plugin-email@4.0.1
  - @objectstack/plugin-hono-server@4.1.0
  - @objectstack/plugin-mcp-server@4.1.0
  - @objectstack/plugin-reports@4.0.1
  - @objectstack/plugin-sharing@4.0.1
  - @objectstack/rest@4.1.0
  - @objectstack/service-ai@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0
  - @objectstack/service-cache@4.1.0
  - @objectstack/service-feed@4.1.0
  - @objectstack/service-job@4.1.0
  - @objectstack/service-package@4.1.0
  - @objectstack/service-queue@4.1.0
  - @objectstack/service-realtime@4.1.0
  - @objectstack/service-settings@0.1.1
  - @objectstack/service-storage@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/objectql@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/rest@4.0.5
  - @objectstack/driver-memory@4.0.5
  - @objectstack/driver-sql@4.0.5
  - @objectstack/driver-turso@4.0.5
  - @objectstack/driver-mongodb@4.0.5
  - @objectstack/plugin-audit@4.0.5
  - @objectstack/plugin-auth@4.0.5
  - @objectstack/plugin-hono-server@4.0.5
  - @objectstack/plugin-security@4.0.5
  - @objectstack/plugin-mcp-server@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5
  - @objectstack/service-cache@4.0.5
  - @objectstack/service-feed@4.0.5
  - @objectstack/service-job@4.0.5
  - @objectstack/service-queue@4.0.5
  - @objectstack/service-realtime@4.0.5
  - @objectstack/service-ai@4.0.5
  - @objectstack/service-storage@4.0.5
  - @objectstack/service-cloud@4.0.5
  - @objectstack/service-package@4.0.5

## Unreleased

### Patch Changes

- `createStudioStaticPlugin` simplified now that the Studio is always built with
  `base: '/_studio/'`: asset URLs in `index.html` are already absolute and
  correct, so the HTML is served verbatim (no `href="/..."` rewriting, no
  runtime basepath script injection). Single source of truth for the mount
  path: Vite `base`.

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/client@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-ai@4.0.4

## 4.0.3

### Patch Changes

- Updated dependencies [ee39bff]
  - @objectstack/service-ai@4.0.3
  - @objectstack/spec@4.0.3
  - @objectstack/core@4.0.3
  - @objectstack/client@4.0.3
  - @objectstack/objectql@4.0.3
  - @objectstack/runtime@4.0.3
  - @objectstack/rest@4.0.3
  - @objectstack/driver-memory@4.0.3
  - @objectstack/plugin-hono-server@4.0.3
  - @objectstack/plugin-setup@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/service-ai@4.0.2
  - @objectstack/client@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/rest@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/objectql@3.3.1
- @objectstack/runtime@3.3.1
- @objectstack/rest@3.3.1
- @objectstack/driver-memory@3.3.1
- @objectstack/plugin-hono-server@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/objectql@3.3.0
- @objectstack/runtime@3.3.0
- @objectstack/rest@3.3.0
- @objectstack/driver-memory@3.3.0
- @objectstack/plugin-hono-server@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/objectql@3.2.8
- @objectstack/runtime@3.2.8
- @objectstack/rest@3.2.8
- @objectstack/driver-memory@3.2.8
- @objectstack/plugin-hono-server@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/objectql@3.2.7
- @objectstack/runtime@3.2.7
- @objectstack/rest@3.2.7
- @objectstack/driver-memory@3.2.7
- @objectstack/plugin-hono-server@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/objectql@3.2.6
- @objectstack/runtime@3.2.6
- @objectstack/rest@3.2.6
- @objectstack/driver-memory@3.2.6
- @objectstack/plugin-hono-server@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/objectql@3.2.5
- @objectstack/runtime@3.2.5
- @objectstack/rest@3.2.5
- @objectstack/driver-memory@3.2.5
- @objectstack/plugin-hono-server@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/objectql@3.2.4
- @objectstack/runtime@3.2.4
- @objectstack/rest@3.2.4
- @objectstack/driver-memory@3.2.4
- @objectstack/plugin-hono-server@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/objectql@3.2.3
- @objectstack/runtime@3.2.3
- @objectstack/rest@3.2.3
- @objectstack/driver-memory@3.2.3
- @objectstack/plugin-hono-server@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-hono-server@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-hono-server@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/objectql@2.0.6
  - @objectstack/runtime@2.0.6
  - @objectstack/rest@2.0.6
  - @objectstack/driver-memory@2.0.6
  - @objectstack/plugin-hono-server@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/objectql@2.0.5
  - @objectstack/driver-memory@2.0.5
  - @objectstack/plugin-hono-server@2.0.5
  - @objectstack/rest@2.0.5
  - @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/objectql@2.0.4
  - @objectstack/runtime@2.0.4
  - @objectstack/rest@2.0.4
  - @objectstack/driver-memory@2.0.4
  - @objectstack/plugin-hono-server@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/objectql@2.0.3
  - @objectstack/runtime@2.0.3
  - @objectstack/rest@2.0.3
  - @objectstack/driver-memory@2.0.3
  - @objectstack/plugin-hono-server@2.0.3

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/objectql@2.0.2
  - @objectstack/driver-memory@2.0.2
  - @objectstack/plugin-hono-server@2.0.2
  - @objectstack/rest@2.0.2
  - @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/objectql@2.0.1
  - @objectstack/runtime@2.0.1
  - @objectstack/rest@2.0.1
  - @objectstack/driver-memory@2.0.1
  - @objectstack/plugin-hono-server@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/objectql@2.0.0
  - @objectstack/driver-memory@2.0.0
  - @objectstack/plugin-hono-server@2.0.0
  - @objectstack/rest@2.0.0
  - @objectstack/runtime@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/runtime@1.0.12
  - @objectstack/objectql@1.0.12
  - @objectstack/driver-memory@1.0.12
  - @objectstack/plugin-hono-server@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/objectql@1.0.11
- @objectstack/runtime@1.0.11
- @objectstack/driver-memory@1.0.11
- @objectstack/plugin-hono-server@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/objectql@1.0.10
  - @objectstack/driver-memory@1.0.10
  - @objectstack/plugin-hono-server@1.0.10
  - @objectstack/runtime@1.0.10
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [b9f8c68]
  - @objectstack/objectql@1.0.9
  - @objectstack/spec@1.0.9
  - @objectstack/core@1.0.9
  - @objectstack/runtime@1.0.9
  - @objectstack/driver-memory@1.0.9
  - @objectstack/plugin-hono-server@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [8f2a3a2]
  - @objectstack/plugin-hono-server@1.0.8
  - @objectstack/spec@1.0.8
  - @objectstack/core@1.0.8
  - @objectstack/objectql@1.0.8
  - @objectstack/runtime@1.0.8
  - @objectstack/driver-memory@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7
  - @objectstack/plugin-hono-server@1.0.7
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7
  - @objectstack/objectql@1.0.7
  - @objectstack/driver-memory@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/objectql@1.0.6
  - @objectstack/driver-memory@1.0.6
  - @objectstack/plugin-hono-server@1.0.6
  - @objectstack/runtime@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/core@1.0.5
  - @objectstack/objectql@1.0.5
  - @objectstack/runtime@1.0.5
  - @objectstack/plugin-hono-server@1.0.5
  - @objectstack/driver-memory@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
- Updated dependencies [5d13533]
  - @objectstack/plugin-hono-server@1.0.4
  - @objectstack/objectql@1.0.4
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/runtime@1.0.4
  - @objectstack/driver-memory@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
- Updated dependencies [22a48f0]
  - @objectstack/core@1.0.3
  - @objectstack/runtime@1.0.3
  - @objectstack/plugin-hono-server@1.0.3
  - @objectstack/objectql@1.0.3
  - @objectstack/driver-memory@1.0.3
  - @objectstack/spec@1.0.3

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
  - @objectstack/objectql@1.0.2
  - @objectstack/runtime@1.0.2
  - @objectstack/driver-memory@1.0.2
  - @objectstack/plugin-hono-server@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1
  - @objectstack/spec@1.0.1
  - @objectstack/core@1.0.1
  - @objectstack/objectql@1.0.1
  - @objectstack/driver-memory@1.0.1
  - @objectstack/plugin-hono-server@1.0.1

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
  - @objectstack/runtime@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/driver-memory@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/objectql@0.9.2
  - @objectstack/driver-memory@0.9.2
  - @objectstack/plugin-hono-server@0.9.2
  - @objectstack/runtime@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/objectql@0.9.1
  - @objectstack/runtime@0.9.1
  - @objectstack/driver-memory@0.9.1
  - @objectstack/plugin-hono-server@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/plugin-hono-server@0.8.2

## 0.8.1

### Patch Changes

- 254f290: fix: serve command now detects available ports to avoid conflicts
  refactor: update to use Core v0.8.0 API (kernel.use/bootstrap)
  - @objectstack/spec@0.8.1
  - @objectstack/core@0.8.1
  - @objectstack/plugin-hono-server@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/plugin-hono-server@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.0
