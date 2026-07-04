# Release Notes

> **v5.0 (2026): `project` → `environment`.** The runtime concept formerly called *Project* (per-tenant business workspace; Org/Project/Branch hierarchy) is now called *Environment* throughout the codebase: CLI flags (`--environment`/`-e`), HTTP paths (`/api/v1/environments/:environmentId/...`), headers (`X-Environment-Id`), env vars (`OS_ENVIRONMENT_ID`), exported symbols (`createSystemEnvironmentPlugin`, `SYSTEM_ENVIRONMENT_ID`), DB columns (`environment_id`), and JSON schemas (`EnvironmentArtifact`) all use the new term with no aliases or deprecation shims. The word "project" elsewhere in this document still refers to the npm/monorepo sense (i.e., the framework as a software project). See `.changeset/v5-project-to-environment-rename.md` for the full breaking-change list and ADR-0006 for the rationale.


## v4.0.4 — Release Readiness: Documentation Alignment _(in progress)_

### 🎯 Purpose

Prepare all 42 packages under `@objectstack/*` for formal public release on npm by:

- Guaranteeing consistent, complete publishing metadata on every package.
- Normalizing README structure so every package documents overview, installation, quick start, exports, configuration, when/when-not, related packages, and links to the docs site.
- Bringing version numbers for previously experimental packages (`service-tenant`, `service-package`) in lockstep with the release train at `4.0.4`.
- Correcting stale package counts and missing entries in the official documentation site.

### 📦 Package inventory (42)

| Category | Count | Packages |
|:---|:---:|:---|
| Core runtime | 7 | `spec`, `core`, `runtime`, `types`, `metadata`, `objectql`, `rest` |
| Client / DX | 5 | `client`, `client-react`, `cli`, `create-objectstack`, `vscode-objectstack` |
| Adapters | 7 | `express`, `fastify`, `hono`, `nestjs`, `nextjs`, `nuxt`, `sveltekit` |
| Drivers | 3 | `driver-memory`, `driver-sql`, `driver-turso` |
| Plugins | 8 | `plugin-auth`, `plugin-security`, `plugin-audit`, `plugin-hono-server`, `mcp`, `plugin-msw`, `plugin-dev`, `plugin-setup` |
| Services | 12 | `service-ai`, `service-analytics`, `service-automation`, `service-cache`, `service-feed`, `service-i18n`, `service-job`, `service-package`, `service-queue`, `service-realtime`, `service-storage`, `service-tenant` |

### ✅ Release readiness checklist

- [x] Canonical README template and publishing checklist committed at `docs/internal/PACKAGE_README_TEMPLATE.md`.
- [x] Every `package.json` has: `description`, `keywords` (≥ 3), `repository` (with `directory`), `homepage`, `bugs`, `license`, `publishConfig.access: public`, `files`, `engines.node`.
- [x] `service-tenant` and `service-package` version-aligned to `4.0.4`.
- [x] `packages/services/service-package/README.md` authored.
- [x] Thin READMEs rewritten: `core`, `rest`, `driver-memory`, `plugin-security`, all 7 adapters.
- [x] `content/docs/plugins/packages.mdx` updated to 42-package inventory including `service-package` and `service-tenant`.
- [x] `content/docs/plugins/packages.mdx` updated to 42-package inventory.
- [x] `CHANGELOG.md` carries a release-prep entry.
- [ ] `pnpm build` passes for every publishable package.
- [ ] `pnpm test` passes.
- [ ] `lychee` link check passes across all READMEs and `content/docs/**`.
- [ ] `pnpm docs:build` succeeds.
- [ ] `content/docs/references/` regenerated via `pnpm --filter @objectstack/spec gen:docs`.

### 📝 Known follow-ups

- Existing strong READMEs (e.g. `service-ai`, `service-storage`, `plugin-audit`, `runtime`, `spec`, `driver-sql`, `driver-turso`) are structurally sound and were not rewritten — they retain their individual voice and depth. A future pass may add standardized npm + license badges across them.
- `content/docs/references/` regeneration is out of scope for this PR because it requires a full spec rebuild; it should run as part of the release pipeline.

---

## v1.2.0 - Studio DX, REST Extraction, Dispatcher Plugin (2026-02-09)

### 📦 Released Packages

All packages updated to **1.2.0**:

- **@objectstack/spec** — Core protocol definitions
- **@objectstack/cli** — CLI toolchain
- **@objectstack/core** — Kernel runtime
- **@objectstack/runtime** — High-level Runtime
- **@objectstack/rest** — REST API plugin (new)
- **@objectstack/client** / **@objectstack/client-react** — Client libraries
- **@objectstack/plugin-hono-server** — Hono HTTP server plugin
- **@objectstack/hono** — Hono adapter
- **@objectstack/objectql** — ObjectQL query engine
- **@objectstack/metadata** — Metadata services
- **@objectstack/driver-memory** — In-memory driver

### ✨ New Features

- **`@objectstack/rest`** — New dedicated package for REST API server, route management, `createRestApiPlugin()`.
- **Dispatcher Plugin** (`@objectstack/runtime`) — Structured route management for auth, GraphQL, analytics, packages, hub, storage, automation via `createDispatcherPlugin()`.
- **Dev Mode Studio UI** (`@objectstack/cli`) — `objectstack serve --dev` auto-enables Studio UI at `/_studio/`. Root `/` redirects to Studio in dev mode. Use `--no-ui` to disable.
- **Interactive API Console** (`@objectstack/studio`) — Live request builder in Object Explorer: select endpoint → edit URL/body → Send → view formatted response with status, timing, and history.
- **Studio Plugin System** (`@objectstack/spec`) — `Studio.PluginManifest` schema for extensible Studio UI plugins.
- **MCP Protocol** (`@objectstack/spec`) — Model Context Protocol schemas for AI tools, resources, prompts, transport.
- **API Versioning** (`@objectstack/spec`) — Schema for multiple versioning strategies (URL path, header, query).
- **Kernel Hot Reload** (`@objectstack/core`) — Production hot reload with full plugin isolation and dynamic loading.
- **Schema Annotations** (`@objectstack/spec`) — `.describe()` on all Zod fields for JSON Schema / IDE docs.

### ⚠️ Migration Guide (from 1.1.0)

#### RuntimeConfig.api removed

```ts
// Before (1.1.0) — implicit
const runtime = new Runtime({ api: { basePath: '/api/v1' } });

// After (1.2.0) — explicit
import { createRestApiPlugin } from '@objectstack/rest';
const runtime = new Runtime();
runtime.use(createRestApiPlugin({ basePath: '/api/v1' }));
```

#### z.any() → z.unknown() (~30 fields)

Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` now use `z.unknown()`. Add type narrowing:

```ts
const meta = record.metadata as Record<string, string>;
```

#### Hub schemas relocated

- `hub/composer.zod.ts`, `hub/marketplace.zod.ts`, `hub/space.zod.ts`, `hub/hub-federation.zod.ts` — removed
- `hub/plugin-registry` → `kernel/plugin-registry`, `hub/license` → `system/license`, `hub/tenant` → `system/tenant`
- Barrel imports via `Hub.*` still work. Direct path imports need updating.

#### MetricType renamed

- `MetricType` (analytics) → `AggregationMetricType`
- `MetricType` (licensing) → `LicenseMetricType`

#### Deprecations

- `HttpDispatcher` → `createDispatcherPlugin()`
- `createHonoApp` → `HonoServerPlugin`

---

## v0.4.1 - Version Synchronization (2026-01-27)

### 📦 Released Packages

All packages have been updated to version **0.4.1**:

- **@objectstack/spec@0.4.1** - Core protocol definitions and TypeScript types
- **@objectstack/types@0.4.1** - Shared TypeScript type definitions
- **@objectstack/objectql@0.4.1** - ObjectQL query language and runtime
- **@objectstack/runtime@0.4.1** - Runtime execution environment
- **@objectstack/client@0.4.1** - Client library for ObjectStack
- **@objectstack/driver-memory@0.4.1** - In-memory data storage driver
- **@objectstack/plugin-hono-server@0.4.1** - Hono server plugin for REST API
- **@objectstack/plugin-msw@0.4.1** - MSW (Mock Service Worker) plugin

### 🐛 Fixes

This patch release resolves version synchronization issues:
- Fixed plugin-msw version mismatch (was incorrectly at 0.3.3)
- Updated runtime peer dependency versions to ^0.4.1 across all plugins
- Ensured all packages in the fixed version group are synchronized

### 🚀 Publishing

This release is ready for publishing to npm. When this PR is merged to `main`:
1. The GitHub Actions release workflow will automatically detect the version bump
2. Build all packages
3. Publish to npm registry using NPM_TOKEN secret
4. Create GitHub release with appropriate tags

---

## v0.4.0 - Minor Version Update (2026-01-26)

### 📦 Released Packages

All core packages have been updated to version **0.4.0**.

### 🚀 Publishing

This release marks a minor version increment across all core packages.

---

## v0.3.3 - Workflow and Configuration Improvements (2026-01-25)

### 📦 Released Packages

All packages have been updated to version **0.3.3**:

- **@objectstack/spec@0.3.3** - Core protocol definitions and TypeScript types
- **@objectstack/types@0.3.3** - Shared TypeScript type definitions
- **@objectstack/objectql@0.3.3** - ObjectQL query language and runtime
- **@objectstack/runtime@0.3.3** - Runtime execution environment
- **@objectstack/client@0.3.3** - Client library for ObjectStack
- **@objectstack/driver-memory@0.3.3** - In-memory data storage driver
- **@objectstack/plugin-hono-server@0.3.3** - Hono server plugin for REST API
- **@objectstack/plugin-msw@0.3.3** - MSW (Mock Service Worker) plugin

### 📝 Changes

This patch release includes:
- Enhanced GitHub workflows for CI, release, and PR automation
- Added comprehensive prompt templates for different protocol areas
- Improved project documentation and automation guides
- Updated changeset configuration for better version management
- Added cursor rules for better development experience

### 🚀 Publishing

This release is ready for publishing to npm. When this PR is merged to `main`:
1. The GitHub Actions release workflow will automatically detect the version bump
2. Build all packages
3. Publish to npm registry using NPM_TOKEN secret
4. Create GitHub release with appropriate tags

---

## v0.3.2 - Maintenance Release (2026-01-24)

### 📦 Released Packages

All packages have been updated to version **0.3.2**:

- **@objectstack/spec@0.3.2** - Core protocol definitions and TypeScript types
- **@objectstack/types@0.3.2** - Shared TypeScript type definitions
- **@objectstack/objectql@0.3.2** - ObjectQL query language and runtime
- **@objectstack/runtime@0.3.2** - Runtime execution environment
- **@objectstack/client@0.3.2** - Client library for ObjectStack
- **@objectstack/driver-memory@0.3.2** - In-memory data storage driver
- **@objectstack/plugin-hono-server@0.3.2** - Hono server plugin for REST API
- **@objectstack/plugin-msw@0.3.2** - MSW (Mock Service Worker) plugin

### 📝 Changes

This is a patch release focusing on:
- Maintenance and stability improvements
- Updated dependencies across all packages
- Improved build consistency

### 🚀 Publishing

This release is ready for publishing to npm. When this PR is merged to `main`:
1. The GitHub Actions release workflow will automatically detect the version bump
2. Build all packages
3. Publish to npm registry using NPM_TOKEN secret
4. Create GitHub release with appropriate tags

---

## v0.2.0 - Initial Public Release

## 📦 Released Packages

All packages are ready for publishing to npm:

- **@objectstack/spec@0.2.0** - Core protocol definitions and TypeScript types
- **@objectstack/types@0.2.0** - Shared TypeScript type definitions
- **@objectstack/objectql@0.2.0** - ObjectQL query language and runtime
- **@objectstack/runtime@0.2.0** - Runtime execution environment
- **@objectstack/client@0.2.0** - Client library for ObjectStack
- **@objectstack/driver-memory@0.2.0** - In-memory data storage driver
- **@objectstack/plugin-hono-server@0.2.0** - Hono server plugin for REST API

## ✨ Features

This is the first public release of the ObjectStack ecosystem, providing:

### Core Capabilities
- **Data Protocol (ObjectQL)**: Complete schema definitions for Objects and Fields
  - 35 field types (text, number, select, lookup, formula, autonumber, slider, qrcode, etc.)
  - Validation rules, workflows, and triggers
  - Permission system and sharing rules
  - Abstract query language for unified data access

### UI Protocol
- **App Configuration**: Navigation, branding, theming
- **View System**: ListView (grid, kanban, calendar, gantt), FormView
- **Analytics**: Dashboards and reports
- **Actions**: Custom buttons and interactions

### System Protocol
- **Manifest**: Package configuration
- **Datasources**: External data connections
- **API**: REST/GraphQL endpoint definitions
- **Translation**: i18n support

### Developer Experience
- **187 JSON Schemas** automatically generated from Zod definitions
- **Complete TypeScript types** with runtime validation
- **Comprehensive documentation** with examples
- **Monorepo structure** with pnpm workspaces

## 📝 Changelog

See individual CHANGELOG.md files in each package:
- [packages/spec/CHANGELOG.md](packages/spec/CHANGELOG.md)
- [packages/client/CHANGELOG.md](packages/client/CHANGELOG.md)
- [packages/objectql/CHANGELOG.md](packages/objectql/CHANGELOG.md)
- [packages/runtime/CHANGELOG.md](packages/runtime/CHANGELOG.md)
- [packages/plugins/driver-memory/CHANGELOG.md](packages/plugins/driver-memory/CHANGELOG.md)
- [packages/plugins/plugin-hono-server/CHANGELOG.md](packages/plugins/plugin-hono-server/CHANGELOG.md)
- [packages/types/CHANGELOG.md](packages/types/CHANGELOG.md)

## 🚀 Publishing

### Automated Publishing (Recommended)
This release is prepared and ready for automated publishing via GitHub Actions:

1. Merge this PR to `main` branch
2. GitHub Actions workflow will automatically:
   - Detect the version bump
   - Build all packages
   - Publish to npm registry using NPM_TOKEN secret
   - Create GitHub release with tags

### Manual Publishing (If needed)
If you need to publish manually:

```bash
# Ensure you're authenticated to npm
npm login

# Build and publish all packages
pnpm run build
pnpm run release
```

## 🏷️ Git Tags

Version tag `v0.2.0` has been created for this release.

## 📚 Documentation

Full documentation is available at:
- Development Roadmap: [DEVELOPMENT_ROADMAP.md](internal/planning/DEVELOPMENT_ROADMAP.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Quick Start: [QUICK_START_IMPLEMENTATION.md](QUICK_START_IMPLEMENTATION.md)

## 🛠️ Build Status

✅ All packages built successfully
✅ All JSON schemas generated (187 schemas)
✅ All documentation generated (187 reference docs)
✅ TypeScript compilation passed
✅ Package versions bumped
✅ Changelogs updated

## 🔍 Pre-publish Verification

Dry-run output confirms all 7 packages are ready:
- ✅ @objectstack/client@0.2.0
- ✅ @objectstack/driver-memory@0.2.0
- ✅ @objectstack/objectql@0.2.0
- ✅ @objectstack/plugin-hono-server@0.2.0
- ✅ @objectstack/runtime@0.2.0
- ✅ @objectstack/spec@0.2.0
- ✅ @objectstack/types@0.2.0

All packages are new and have not been published to npm yet.
