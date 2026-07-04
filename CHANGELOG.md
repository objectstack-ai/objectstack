# Changelog

All notable changes to the ObjectStack Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — Security: anonymous access denied by default (BREAKING) + destructive-op RBAC gates

- **`api.requireAuth` now defaults to `true`** (ADR-0056 D2 flip): anonymous
  requests to `/data/*` CRUD + batch endpoints are rejected with HTTP 401
  unless the deployment explicitly opts out with `api: { requireAuth: false }`
  (the REST plugin logs a boot warning for the explicit opt-out). Share-links,
  public forms (via the declaration-derived `publicFormGrant`), and the
  control plane (`/auth`, `/health`, `/discovery`) keep working with no
  action. `objectstack serve` passes an explicit `false` only for stacks with
  no `auth` tier (nothing could authenticate against them). Conformance row
  `requireAuth-default-flip` → `enforced`.
- **`transfer` / `restore` / `purge` are RBAC-gated ahead of the ops** (#1883):
  the permission evaluator maps them to `allowTransfer` / `allowRestore` /
  `allowPurge` (with the `modifyAllRecords` super-user bypass), so when the
  M2 operations ship there is no ungated window. Unmapped destructive
  operations keep failing closed (ADR-0049).

### Added — ObjectUI one-month frontend scan + backend alignment summary

Scanning `../objectui` from 2026-05-08 through 2026-06-08 shows a broad Studio
and renderer push, not just the most recent commits. Major frontend changes
include live field-level conditional rules in forms (`visibleWhen`,
`readonlyWhen`, `requiredWhen`), row-scoped inline-grid rules,
required-on-submit handling, spreadsheet-style master-detail line-item editing,
atomic parent+child form saves, derived related lists, record-page authoring,
page block/property inspectors, flow-designer typed config panels and
simulator, dataset designer/preview, dataset-bound dashboard widgets and
reports, report matrix/joined/drill-down renderers, dashboard drill-downs and
type-aware cells, metadata-admin draft/publish/rollback and skew protection,
AI draft review/publish surfaces, public/developer API pages, settings,
notifications/approvals, marketplace/package management, and wide i18n polish.

The scan covered 910 non-merge commits in `../objectui`: 369 `feat`, 213 `fix`,
108 `chore`, 37 `refactor`, plus docs/tests/CI/perf work. The largest touched
areas were `packages/app-shell`, `apps/console`, `packages/plugin-detail`,
`packages/plugin-dashboard`, `packages/plugin-grid`, `packages/fields`,
`packages/plugin-report`, `packages/plugin-form`, `packages/plugin-list`, and
`skills/objectui`.

The framework backend now mirrors the critical enforcement boundaries:
`@objectstack/plugin-security` exposes `security.getReadFilter(object,
context)` as a reusable RLS read scope, `@objectstack/service-analytics`
auto-bridges to it for dataset/dashboard/report queries and fails closed when
scope cannot be safely applied, and ObjectQL enforces field conditional rules
by validating `requiredWhen` and ignoring writes to fields locked by
`readonlyWhen`.

### Fixed — First-boot platform-admin promotion no longer stolen by the `usr_system` seed identity

`5e831dea3` (#1392) added `ensureSeedIdentity` to the runtime SeedLoader, which
upserts a non-loginable system identity (`usr_system`, role `system`,
`system@objectstack.local`) to own seeded records — created *before* the first
human sign-up. Because `bootstrapPlatformAdmin` (`@objectstack/plugin-security`)
promotes the **earliest-created** `sys_user`, on any app that ships seed data
(e.g. the showcase / CRM examples) `usr_system` won the promotion and the real
admin login stayed at `role: user`. Sign-in succeeded but **Setup and Studio**
— gated by `setup.access` / `studio.access` on `admin_full_access` — were
invisible, a silent and confusing regression.

`bootstrap-platform-admin.ts` now excludes the system account
(`id === SystemUserId.SYSTEM || role === 'system'`) when picking the first user
to promote, and the "an admin already exists" short-circuit ignores any
`admin_full_access` grant held by `usr_system`, so a database where it was
wrongly promoted self-heals on the next boot. Verified end-to-end: `pnpm dev`
→ the seeded admin's `get-session` now resolves `role: admin` and the
cross-tenant `admin_full_access` grant belongs to the human admin.

Alongside this, `os dev`'s seed-admin defaults changed from `admin@dev.local` /
`admin12345` to the fixed, well-known `admin@objectos.ai` / `admin123`
(`@objectstack/cli`), so tooling and docs never have to guess the credentials.

### Changed — Object metadata preview now mounts real `ObjectGrid`; Airtable widget removed (ADR-0014 addendum)

The first cut of ADR-0014 shipped a parallel `FieldsTable` component
(used both as the Object preview and as a `widget: 'airtable'` editor
for `object.fields`). That hybrid surface conflated **data view** with
**schema editor** and could only honestly expose ~5 of the Field
protocol's ~30 properties. It has been removed.

**Preview pane** now mounts `<ObjectGrid>` from
`@object-ui/plugin-grid` — the same runtime renderer production uses —
with columns derived from `draft.fields` and rows fetched from the
real REST API. What you preview is what you ship.

**Form panel Fields section** uses the default `RecordField`
inline-card mode (no widget override). Each card has a drag handle
(`GripVertical`) for HTML5 drag-to-reorder, expands to a sub-form
covering the full Field protocol (`label`, `type`, `required`,
`unique`, `indexed`, `readonly`, `immutable`, `hidden`, `searchable`,
`sortable`, `filterable`, `defaultValue`, `placeholder`, text/number
constraints, `options[]` with color+icon for select-likes,
`reference`/`referenceFilter`/`cascadeDelete`/`multiple` for
relations, `formula`+`returnType` for formulas,
`summaryType`+`summaryField` for rollups, `displayFormat`+
`startingNumber` for autonumber, `language` for code, `validation`+
`errorMessage`, plus `audit`/`trackHistory`/`pii`/`encrypted`). All
type-specific fields use `visibleOn` CEL predicates so the form
adapts as the user picks a type.

**Removed**: `previews/object/FieldsTable.tsx`,
`previews/object/field-meta.ts`, `ObjectFieldsTableWidget`, the
`'airtable'` and `'object-fields-table'` keys in `WIDGETS`, the
`widget: 'airtable'` line in `object.form.ts`.

The `'record'` form-field type, the `keyField` config, the
`RecordField` engine, and the corrected JSON Schema for
`object.properties.fields` (introduced in the original ADR-0014)
remain in place. See
[`docs/adr/0014-record-form-field-type.md`](docs/adr/0014-record-form-field-type.md)
§ "Why not Airtable mode" for the full rationale.

### Added — `record` form field type (ADR-0014)

`Object.fields` (and other `Record<string, X>` properties) can now be
edited as first-class form fields instead of leaking through as raw
JSON. New `'record'` entry in the `FieldType` enum, complementary
`keyField` config on `FormFieldSchema`, native `RecordField` engine in
the Studio `SchemaForm`.

The hand-crafted JSON Schema for `object.properties.fields` in
`packages/objectql/src/protocol.ts` no longer lies about the shape
(`type: 'object', additionalProperties: …` instead of `type: 'array'`).
Existing array-shaped drafts are tolerated on read; the first save
migrates them to the canonical Record.

See [`docs/adr/0014-record-form-field-type.md`](docs/adr/0014-record-form-field-type.md).

### Breaking — `@objectstack/plugin-security` org-scoping split into `@objectstack/plugin-org-scoping`

**Removed from `plugin-security`**: the `multiTenant` constructor option,
the `organization_id` auto-stamp middleware, the `sys_organization`
post-create seed-replay pipeline, the default-organization bootstrap,
and the `cloneTenantSeedData` export.

**New package**: [`@objectstack/plugin-org-scoping`](packages/plugins/plugin-org-scoping/README.md)
ships the row-level Organization scoping primitives — `organization_id`
auto-stamp, per-org seed replay, default-org bootstrap, orphan-row
claim, and a new `org-scoping` service that `plugin-security` probes at
start time to decide whether to keep wildcard `tenant_isolation` RLS
policies.

**Why**: per ADR-0002, "tenant" in ObjectStack means *physical*
isolation (one Environment = one database). The row-level
`organization_id` scoping is a different concept — *logical* scoping
inside a single DB — so it belongs in its own opt-in plugin. Splitting
it leaves single-org deployments leaner (no wildcard RLS to strip on
every query) and gives multi-org deployments a clearer extension point.

**Migration**: single-org deployments need no changes. For multi-org
(formerly `new SecurityPlugin({ multiTenant: true })`):

```diff
+ import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
  import { SecurityPlugin } from '@objectstack/plugin-security';

+ await kernel.use(new OrgScopingPlugin());   // MUST register BEFORE SecurityPlugin
- await kernel.use(new SecurityPlugin({ multiTenant: true }));
+ await kernel.use(new SecurityPlugin());
```

The `OS_MULTI_TENANT=true` env switch — read by
`@objectstack/runtime/cloud/ArtifactKernelFactory`,
`@objectstack/plugin-dev`, and the `objectstack` CLI's
`serve` / `dev` / `start` commands — automatically registers
`OrgScopingPlugin` ahead of `SecurityPlugin`, so projects driven by the
CLI need no code changes.

See `.changeset/plugin-org-scoping-split.md` for the full breaking-change
list and ADR-0002 for the rationale on physical-vs-logical tenancy.

### Breaking — `@objectstack/plugin-security` no longer auto-creates personal workspaces

**Removed**: the `sys_user` post-insert middleware that auto-created a
"`<User>'s Workspace`" organisation + owner-member row for every new
user in multi-tenant mode, and the exported `ensureUserHasOrganization`
helper that backed it.

**Why**: the helper was a B2C-shaped opinion ("every user gets a
personal workspace") baked into framework defaults. It actively misfired
in B2B / invitation-driven flows — a user invited into an existing org
ended up owning a disjoint personal workspace alongside the org they
were invited to, because `sys_user.create.after` fires before
better-auth's `acceptInvitation` writes the `sys_member` row. There was
no opt-out switch; products that wanted invitation-only semantics had no
clean path. Removing the helper (no flag, no toggle) collapses the
design to the canonical Slack / Linear / GitHub-Orgs model: users must
either accept an invitation or explicitly create their first
organisation. The `apps/account` `/register` route already routes
users with zero memberships to `/organizations/new`, so the UX path
exists today.

**One legitimate auto-org case kept, moved**: the very first registered
user (= the user the framework auto-promotes to platform admin via
`bootstrapPlatformAdmin`) still needs an `activeOrganizationId` on
their session for the default `tenant_isolation` RLS policy to resolve.
`bootstrapPlatformAdmin` now accepts `multiTenant: boolean` and, when
true and the freshly-promoted admin has zero memberships, creates a
single `Default Organization` (slug `default`) and binds them as
`owner`. Idempotent across cold-boots (re-uses any existing
`slug='default'` row). Single-tenant deployments are unaffected — no
orgs are created at all (verified empirically with `pnpm dev:crm`:
2 signups → 2 users, 0 orgs, 0 members; first user has
`admin_full_access`).

**Migration**:
- Existing deployments that relied on the personal-workspace auto-creation
  for self-service signups should either (a) invite users explicitly,
  or (b) direct new users to `/organizations/new` (which the account UI
  already does when `organizations.length === 0`).
- The cloud `ArtifactKernelFactory` per-project `AuthPlugin` no longer
  installs the `databaseHooks.user.create.after` hook that called
  `ensureUserHasOrganization`. Project owners are still bound to the
  mirrored cloud-team org by `seedProjectOrganization` +
  `seedProjectMember`, so cloud-deployed projects behave identically.
- `@objectstack/plugin-security` no longer exports
  `ensureUserHasOrganization`; consumers that imported it must remove
  the call (the underlying problem the helper "solved" should be
  handled by the account UI's "create your first organisation" flow).
- `cloneTenantSeedData` is unchanged and still wired to the
  `sys_organization` insert middleware, so any *explicitly* created
  org (bootstrap default, cloud-team mirror, user-initiated
  `createOrganization`) still receives a private copy of demo data.

### Fixed — `@objectstack/objectql` test suite re-aligned with current overlay policy

The CI `Test Core` job had been failing on `@objectstack/objectql#test`
since the `Test Core` paths filter first re-engaged after the
`feat: add project mode, metadata forms, and org overlays` series
(`ba252da0b`, `482eb67cc`) shifted the overlay/persistence contract
without updating the affected fixtures.

- Updated four test files — `overlay-precedence.test.ts`,
  `protocol-meta.test.ts`, `protocol-meta-types-rich.test.ts`, and
  `sys-metadata-repository.test.ts` — to track the current
  `DEFAULT_METADATA_TYPE_REGISTRY` (object/field/flow/workflow/agent/
  permission/role/profile/action/approval now opt into per-org
  overlay; the invariant pin now covers the execution/wiring-layer
  types — trigger/validation/hook/datasource/router/function/service —
  that must stay non-overridable).
- Adjusted persistence assertions for the new `sys_metadata` row
  shape (`checksum` / `created_at` / `updated_at`, no `scope`) and
  the dedicated `sys_metadata_history` table, plus optimistic-
  concurrency (`parentVersion`) usage and the now-unwrapped DB
  error propagation.
- No production code changed. `pnpm turbo run test --filter
  @objectstack/objectql` is green (371/371).

### Added — Settings → runtime bridge for the embedder

The `embedder_*` settings configured in **Setup → AI & Embedder** now
build a real `IEmbedder` instance at runtime and register it as a
kernel DI service.

- New `EMBEDDER_SERVICE = 'embedder'` DI token in
  `@objectstack/spec/contracts`.
- `@objectstack/service-ai` extends its settings-binding loop to
  dynamically construct an `OpenAIEmbedder` (via
  `@objectstack/embedder-openai`'s `createOpenAIEmbedder`) and
  register/replace it under `EMBEDDER_SERVICE`. Live swap on every
  `settings:changed` event for namespace `ai`.
- `AIServicePlugin` registers a live `ai/test_embedder` action that
  performs a real `embed(['ping'])` round-trip against the form's
  (possibly unsaved) values and reports vector dims + latency.
- `@objectstack/knowledge-turso`'s `embedding` option is now optional;
  the plugin auto-resolves `EMBEDDER_SERVICE` at `start()` when no
  explicit embedder is passed. Logs `(embedder=<id>, dims=<n>)` on
  registration. Warns + no-ops if neither path resolves.
- 10 new tests (5 in service-ai, 5 in knowledge-turso). All green.

End-to-end: operator picks 硅基流动 + paste API key + `BAAI/bge-m3` in
the Setup app, hits Save → in the same process the embedder is live and
every knowledge adapter started without an explicit embedder picks it
up. No restart, no env vars.

### Added — Setup App: complete Configuration settings pages

The Setup App's **Configuration** left-nav now lists every built-in
settings namespace (Storage was previously missing entirely, Knowledge
had no entry, and AI lacked an Embedder section):

- **AI manifest** gained a full Embedder section — provider select
  with 10 options (`none` / `openai` / `azure` / `dashscope` (阿里通义)
  / `zhipu` (智谱) / `siliconflow` (硅基流动) / `doubao` (火山引擎)
  / `minimax` / `ollama` / `custom`), encrypted API key, model,
  optional base URL (custom/azure only), Matryoshka dimensions
  override, batch size, and a `Test embedder` button.
- **New `knowledge` settings namespace** — adapter selection
  (`memory` / `turso` / `ragflow`), Turso connection URL + encrypted
  auth token (blank URL = reuse tenant's primary libSQL connection),
  RAGFlow base URL + key + default dataset, indexing defaults
  (`chunk_target`, `chunk_overlap`, `over_fetch`), and a security-
  critical `enforce_rls` toggle that defaults to `true`.
- **Setup App nav** — added File Storage + Knowledge entries; left-nav
  order now matches `builtinSettingsManifests`.
- **i18n** — full `ai` and `knowledge` blocks for `en` and `zh-CN`,
  including all 10 embedder provider option labels and adapter help
  text.

### Added — `IEmbedder` protocol + `@objectstack/embedder-openai` plugin

Extracted text-→-vector providers into a dedicated, plugin-shaped layer:

- **`IEmbedder`** contract added to `@objectstack/spec/contracts` —
  protocol-level interface (`id`, `dimensions`, `embed(texts[])`).
  One contract covers cloud APIs, local Ollama, and in-process embedders.
- **`@objectstack/embedder-openai`** — new plugin package. Drop-in for
  any OpenAI-shape endpoint via `baseUrl`. Ships preset constants for
  8 mainstream providers (OpenAI, Azure, 阿里通义 DashScope, 智谱
  BigModel, 硅基流动 SiliconFlow, 火山引擎 Doubao, MiniMax, Ollama)
  and pre-baked default `dimensions` for 16+ popular models including
  `text-embedding-v3`, `embedding-3`, `BAAI/bge-m3`, `nomic-embed-text`.

```ts
import { createOpenAIEmbedder } from '@objectstack/embedder-openai';
const embedding = createOpenAIEmbedder({
  preset: 'siliconflow',
  apiKey: process.env.SILICONFLOW_API_KEY!,
  model: 'BAAI/bge-m3',
});
```

### Changed — `@objectstack/knowledge-turso` consumes `IEmbedder`

`KnowledgeTursoPluginOptions.embedding` is now typed as `IEmbedder`
(`@objectstack/spec/contracts`). The package no longer ships an
OpenAI provider of its own — install `@objectstack/embedder-openai`.

**Breaking:**
- `OpenAIEmbeddingProvider` removed from `@objectstack/knowledge-turso`
  exports. Replace with `OpenAIEmbedder` from `@objectstack/embedder-openai`.
- `HashEmbeddingProvider` renamed to `HashEmbedder` (old name kept as a
  deprecated alias).
- `EmbeddingProvider` type kept as a deprecated alias for `IEmbedder`.

### Added — Runtime `services.*` API reference chapter

Documentation now includes a dedicated `Runtime Services` guides chapter
(`content/docs/guides/runtime-services/`) covering:

- `services.data`
- `services.sharing`
- `services.audit`
- `services.queue`
- `services.email`
- `services.settings`
- `services.storage`

The chapter includes per-service method signatures, parameter/return
notes, error semantics, stability labels (`stable` / `experimental`),
and practical examples for flows, hooks, and plugin event
subscriptions.

### Fixed — `objectstack init` produces a working project

`npx @objectstack/cli init my-app` used to scaffold a project that
could not install or run:

- The generated `package.json` pinned every dependency with the
  `workspace:*` / `workspace:^` protocol, so pnpm/npm/yarn/bun all
  rejected the install with
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` outside the monorepo.
- The `plugin` template omitted `@objectstack/cli` from
  `devDependencies`, so `npm run dev` failed with
  `sh: objectstack: command not found` even when install succeeded.
- `objectstack init my-app` scaffolded into the **current** directory
  while the summary printed `Project: my-app / Directory: <cwd>` —
  misleading users into clobbering an unrelated folder.
- When dependency installation failed, the command still printed
  `✓ Project initialized!` followed by `Next steps: objectstack dev`,
  none of which worked without `node_modules`.
- The install step was hard-coded to `pnpm install` regardless of how
  the CLI was invoked.

The `init` command now:

- Pins every scaffolded `@objectstack/*` dependency to the CLI's own
  version (e.g. `^6.5.0`), resolved at runtime from the CLI's
  `package.json`. The version pin tracks every release automatically
  and matches the package set that was just `npx`'d.
- Always includes `@objectstack/cli` in `devDependencies` so generated
  npm scripts can resolve the `objectstack` binary.
- Creates `./<name>/` when a project name is supplied (matching
  `npm create`, `pnpm create`, `vite`, etc.), refusing to overwrite a
  non-empty target directory. Omitting the name keeps the previous
  current-directory behaviour.
- Validates the project name (lowercase, npm-safe) before doing any I/O.
- Auto-detects the invoking package manager from
  `npm_config_user_agent` (npm / pnpm / yarn / bun), with a new
  `--package-manager` flag for explicit overrides.
- Treats install failure as a hard error — prints a clear `cd` +
  `<pm> install` remediation path and exits non-zero instead of
  pretending the project is ready.
- Tailors `Next steps` to include `cd <dir>` and `<pm> exec
  objectstack …` so the printed commands actually work from where the
  user is standing.

### Fixed — Changesets `fixed` group now covers every public package

Two newly added services — `@objectstack/service-cluster` and
`@objectstack/service-cluster-redis` — were missing from the `fixed`
group in `.changeset/config.json`, so they were not bumped in lockstep
with the rest of `@objectstack/*` during the last release. Both names
have been added back to the group.

To prevent this class of drift from recurring, a new validator
(`scripts/check-changeset-fixed.mjs`) compares every public workspace
package against the `fixed` group and fails CI if any public package is
missing (or if a stale name lingers in the group). It runs:

- On every PR that touches `**/package.json`, `pnpm-workspace.yaml`,
  `.changeset/config.json`, or the script itself (`validate-deps.yml`).
- Before `changeset publish` in the `Release` workflow, so a release
  cannot ship while the `fixed` group is out of sync.
- Locally via `pnpm run lint:changeset`.

### Changed — `@object-ui/*` upgraded to v6.0

Bundled UI assets (`@object-ui/console`, `@object-ui/studio`,
`@object-ui/i18n`) bumped from `5.4.2` → `6.0.0` across the workspace
(`@objectstack/cli`, `@objectstack/account`, root devDep). The v6
release ships a new UI shell — refreshed sidebar, redesigned record
header, updated design tokens. The ObjectStack protocol surface is
unchanged; only pages rendered through the CLI's `studio` / `console`
mounts look different.

### Changed — Knowledge adapter packages renamed (no `plugin-` prefix)

The three Knowledge Protocol adapter packages dropped the `plugin-`
prefix to match `driver-*` brevity and form a clean `knowledge-*`
family alongside the `@objectstack/service-knowledge` orchestrator:

| Old | New |
|---|---|
| `@objectstack/plugin-knowledge-memory` | `@objectstack/knowledge-memory` |
| `@objectstack/plugin-knowledge-ragflow` | `@objectstack/knowledge-ragflow` |
| `@objectstack/plugin-knowledge-turso` | `@objectstack/knowledge-turso` |

`@objectstack/service-knowledge` is unchanged — services keep the
`service-*` namespace. The `.changeset/config.json` `fixed` group now
includes all four knowledge packages so they version together.

The packages had not yet been published, so this is a rename-only
change with no upgrade path required for external consumers.

### Added — Knowledge Protocol end-to-end smoke test

New `examples/app-todo/test/ai-knowledge-llm.test.ts` proves the
permission-aware retrieval loop end-to-end: seed 5 `todo_task` rows
across two owners, register `task_notes` as a Knowledge source over
that object, reindex via `KnowledgeMemoryPlugin`, then run
`KnowledgeService.search` as Alice / Bob / system. Each actor sees
only the rows their `ExecutionContext` is permitted to read — proving
the RLS re-check in `KnowledgeService.applyPermissionFilter` is
engaged. When `AI_GATEWAY_API_KEY` is present, the test also runs a
real LLM through `ai.chatWithTools` and asserts the assistant invokes
`search_knowledge` and never leaks the other owner's rows. Run via
`pnpm --filter @example/app-todo test:knowledge:llm`.

### Changed — Studio sidebar: registry-driven Workspaces group

The hardcoded "Public forms" entry that lived inside the Overview block
has been moved to a dedicated **Workspaces** sidebar group powered by a
small `STUDIO_WORKSPACES` registry. This separates curated workflow
lenses (which stitch together several metadata items to answer one
operational question — "what's publicly exposed?") from the
auto-generated metadata browser below. New presets are now 1-line
registry additions instead of bespoke menu items, and the active-state
check is wired through TanStack `useLocation` instead of
`window.location`.

### Removed — Unused Studio dependencies

Dropped 10 packages from `apps/studio` that no source files reference
after the single-tenant simplification: `@ai-sdk/anthropic`,
`@ai-sdk/gateway`, `@ai-sdk/google`, `@ai-sdk/openai`,
`@hono/node-server`, `hono`, `@objectstack/hono`,
`@objectstack/plugin-audit`, `@objectstack/plugin-auth`,
`@objectstack/plugin-security`, `@objectstack/driver-turso`. Verified
with full build + 84 vitest pass.

### Added — Studio FormView publishing UI

The `/$package/public-forms` preset now ships with two dialogs:
- **Publish form…** — pick any existing FormView and publish it as a
  public form in one click; sets `sharing.allowAnonymous`,
  `sharing.enabled`, and `sharing.publicLink: /forms/<slug>` via
  `client.meta.saveItem('view', name, …)`.
- **Edit sharing & post-submit** (per-row gear icon) — change the
  public slug and pick a `submitBehavior` variant (thank-you with
  title/message, redirect, continue, next-record).

This closes the loop on customer-self-service: operators no longer
have to hand-edit metadata files to expose or reconfigure a form.

### Docs — Forms guide expanded for public + internal modes

`content/docs/guides/public-forms.mdx` (kept slug for backwards links)
now documents the unified Forms model: public `/f/:slug` *and* internal
`/forms/:name`, URL prefill, the `submitBehavior` union, the new
`type: 'form'` action, and the `defaultDetailForm` ObjectSchema binding.

### Added — `defaultDetailForm` on ObjectSchema

Objects can now declare which named FormView powers their record-detail
screen via `defaultDetailForm: '<form_view_name>'`. This is the missing
piece that lets the same FormView metadata drive Airtable-style internal
edit panels in addition to public submissions — the runtime resolves
the named view from `views.formViews`, falling back to the unnamed
`view.form` and finally to an auto-generated layout.

### Added — `type: 'form'` action variant

`ActionType` now includes `'form'` for actions that open a FormView.
`target` is the FormView name; the runtime navigates to
`/console/forms/:name`. This lets apps wire "New lead" / "New ticket"
buttons declaratively without resorting to free-form URLs.

### Added — Unified FormPage: public `/f/:slug` + internal `/forms/:name`

The console now ships a single `FormPage` renderer that powers both the
anonymous public form (`/console/f/:slug`, no auth) and the authed
internal form route (`/console/forms/:name`). Both modes read the same
`FormView` metadata and use the same field renderers — only the spec
source and submit target differ.

- Public mode loads via `GET /api/v1/forms/:slug` and submits to
  `POST /api/v1/forms/:slug/submit` (anonymous, field-whitelisted).
- Internal mode loads via `GET /api/v1/meta/view/:name` plus
  `GET /api/v1/meta/object/:object`, and submits via the regular
  `POST /api/v1/data/:object` data endpoint (auth cookie carries
  identity; permissions enforced server-side).
- URL params `?prefill_<field>=<value>` populate initial values in
  both modes.
- Honors a `submitBehavior` discriminated union on the FormView
  (`thank-you` | `redirect` | `continue` | `next-record`) — defaults
  to a thank-you screen.

### Changed — Studio simplified into a metadata browser

`apps/studio` was collapsed from a multi-tenant project/org/cloud admin
into a single-tenant **metadata browser + runtime debugger**. The
"project" and "organization" concepts are gone from the UI; everything
runs against the single `sys_metadata` table that already underpins the
runtime.

- Routes flattened to `/`, `/$package`, `/$package/metadata/$type/$name`,
  `/$package/objects/$name`, plus the new `/$package/public-forms`.
- Deleted: organization/project/login/register/platform/api-console
  top-level routes, project switcher, organization switcher, project
  members panel, and every `useProjects*` / `useOrgApps` / `useProjectAwarePackages`
  hook.
- Kept: runtime preview & debug plugins (`agent-playground`,
  `tool-playground`, `flow-viewer`, `ApiConsolePage`, `QueryBuilder`,
  `AiChatPanel`) — these stay essential for inspecting the live
  metadata graph.
- `useScopedClient(_id?)` is now a back-compat shim that always returns
  the unscoped client, so the surviving plugins keep working without
  touch-ups.

### Added — Studio "Public forms" preset

Studio now surfaces every `FormView` with `sharing.allowAnonymous` +
`sharing.publicLink` as a first-class entry in the sidebar
(`/$package/public-forms`). The page lists each public form with its
slug, target object, and the resolved `/console/f/:slug` URL, plus
one-click copy actions for the raw URL, an `<iframe>` snippet, and a
React snippet — giving non-developer admins everything they need to
embed a Web-to-Lead form without touching code.

### Changed — Bumped `@object-ui/*` to `5.0.1`

All `@object-ui/*` dependencies in `apps/console` and `apps/account` were
upgraded from `^4.8.0` to `^5.0.1` (`pnpm up -r --latest "@object-ui/*"`).
Console typecheck and build pass cleanly on the new major. One non-blocking
peer warning remains: `@object-ui/plugin-report@5.0.1` still declares
`react@^18` while the workspace runs `react@19` — safe to ignore until
the next upstream release relaxes the peer.

### Added — Public Forms (anonymous Web-to-Lead / Web-to-Case)

The framework now auto-registers a pair of anonymous REST endpoints for any
`FormView` declared with `sharing.allowAnonymous: true` and a `publicLink`
slug. No new metadata type — the existing `FormView` schema is the source
of truth.

- `GET  /api/v1/forms/:slug` — returns the form spec plus an `objectSchema`
  restricted to the form's whitelisted fields, so an anonymous front-end can
  render labels / types / select options without an auth-protected meta
  call.
- `POST /api/v1/forms/:slug/submit` — accepts only fields listed in the
  form's `sections[].fields[]` whitelist, attaches a
  `permissions: ['guest_portal']` execution context, then calls
  `protocol.createData()`. Bypasses `enforceAuth`, so it works even when
  the project requires auth.

Authors stamp server-controlled defaults (`status`, `lead_source`,
`origin`, …) and strip privileged fields (`owner`, `internal_notes`, …)
in a `beforeInsert` hook keyed on `!ctx.previous && !ctx.user?.id`. The
`guest_portal` profile must exist and be INSERT-only on the target
object.

See `content/docs/guides/public-forms.mdx` for the full contract,
security checklist, and CRM Web-to-Lead / Web-to-Case examples.

### Fixed — Hook sandbox now distinguishes insert from update

`packages/runtime/src/sandbox/body-runner.ts` :: `unwrapProxyToPlain()`
used to return `{}` (truthy empty object) whenever the source value was
`undefined`. As a result, every hook running in the QuickJS sandbox
observed `ctx.previous = {}` on `beforeInsert`, so the canonical
"guest insert" check `!ctx.previous && !ctx.user?.id` always evaluated
to `false` and guest-default hooks silently no-op'd.

`unwrapProxyToPlain` now returns `undefined` for nullish input, so
`ctx.previous` is honestly `undefined` on insert and truthy only on
update / delete. This restores the documented hook contract and is
required for the new Public Forms endpoints to apply guest defaults.

### Removed — Cloud control plane moved to private `objectstack-ai/cloud` repo

The framework repository (`objectstack-ai/framework`) is now open-core only.
The hosted Cloud control plane — `apps/cloud` and
`@objectstack/service-cloud` — has been extracted to a separate, private
repository (`objectstack-ai/cloud`). Production traffic on
`cloud.objectos.app` is now served from that repo as a Cloudflare Container
Worker.

What this means for framework consumers:

- **`packages/services/service-cloud`** — deleted from this repo. ~10k LOC,
  56 files. Lives in `objectstack-ai/cloud` going forward.
- **`apps/cloud`** — deleted from this repo. The reference cloud host now
  lives in `objectstack-ai/cloud/apps/cloud`.
- **`apps/objectos`** — deleted from this repo. The tenant runtime
  (serving `*.objectos.app`) now lives in `objectstack-ai/cloud/apps/objectos`.
  Production traffic continues uninterrupted on the same Cloudflare Worker
  (atomic flip by overwriting the worker named `objectos` from the cloud
  repo, which uses the same CF account). The framework `deploy.yml`
  GitHub Actions workflow has been deleted along with it.
- **`@objectstack/cli`** — no longer hard-depends on
  `@objectstack/service-cloud`. The `serve --mode=cloud` boot path keeps
  the existing optional dynamic `import('@objectstack/service-cloud')`
  with a try/catch that surfaces a clear "install / use cloud-aware
  distribution" hint when the package is absent. The ambient TypeScript
  stub (`packages/cli/src/types/service-cloud.d.ts`) is retained so the
  optional path still typechecks.
- **Root `pnpm dev` / `pnpm start` / `pnpm doctor` scripts removed** —
  these were thin aliases for `pnpm --filter @objectstack/objectos …`
  which no longer exists in this repo. Use the cloud repo for objectos
  development, or `pnpm --filter @example/app-crm dev` for a local
  reference runtime.
- **Structural couplings remain `any`-typed.** `packages/runtime/`,
  `packages/rest/`, and `packages/adapters/hono/` previously documented
  service-cloud as the source of `KernelManager` / `EnvironmentDriverRegistry`
  but never imported it. Doc comments are retained; behaviour is unchanged.
- **Tag `pre-cloud-split`** marks the last commit before this extraction
  and can be used as a rollback anchor.

### Added — Cloud identity split: `os cloud login` separates from `os login`

Introduced a second credential store at `~/.objectstack/cloud.json` to model
the two distinct identities a developer holds on their machine:

1. **Runtime identity** — your account on the ObjectOS instance you build
   and operate (your CRM / Todo / SaaS). Stored in
   `~/.objectstack/credentials.json` via the existing `os login`. Default
   server stays at `http://localhost:3000` (env `OS_RUNTIME_URL`).

2. **Cloud identity** — your developer account on the hosted ObjectStack
   Cloud package registry at `https://cloud.objectos.app`. Stored in
   `~/.objectstack/cloud.json` via the new `os cloud login` command.

This eliminates the prior ambiguity where one token+url slot tried to
serve both "manage my local data" and "publish my package to the
registry" workflows.

**New commands**

- `os cloud login` — RFC 8628 device-flow (or `--email/--password`)
  against `https://cloud.objectos.app` (override via `--url` /
  `OS_CLOUD_URL` for self-hosted registries).
- `os cloud logout` — best-effort session revocation + clears
  `cloud.json`.
- `os cloud whoami` — verifies the cached token against
  `/api/v1/auth/get-session` and prints the active cloud identity.
- `os package publish` (ADR-0006 v4 Phase B) — uploads
  `dist/objectstack.json` as a `sys_package` + `sys_package_version`
  pair into the caller's organization on the cloud control plane.
  Reads credentials **only** from `~/.objectstack/cloud.json` (never
  falls back to the runtime `credentials.json`, preventing accidental
  "publish with my app-user token" mistakes). Default server is
  `https://cloud.objectos.app`.

**Updated commands**

- `os login` env var renamed from `OS_CLOUD_URL` to `OS_RUNTIME_URL` to
  make the runtime-vs-cloud distinction explicit at the shell level.

**New utilities**

- `packages/cli/src/utils/cloud-config.ts` — read/write/delete helpers
  for `~/.objectstack/cloud.json` plus `DEFAULT_CLOUD_URL` constant.
- `packages/cli/src/utils/auth-flows.ts` — shared `loginWithBrowser` /
  `loginWithPassword` flows so runtime and cloud login paths can stay
  in sync without duplicating the RFC 8628 polling loop.
### Added — `objectstack package publish` CLI (ADR-0006 v4 Phase B)

New CLI command for uploading a compiled artifact as a versioned package
into the caller's organization on ObjectStack Cloud. Pairs with the
`POST /cloud/packages` + `POST /cloud/packages/:id/versions` routes
that landed in commit `9f87aa8f`.

- `packages/cli/src/commands/package/publish.ts` — new oclif command
  `os package publish [artifact]`. Flow:
  1. Reads `dist/objectstack.json` (or path arg).
  2. Derives `manifest_id` (default `local.<slug>` if artifact lacks
     a reverse-domain id) and version (default `artifact.manifest.version`
     or a timestamped `0.0.0-dev.<ts>`).
  3. POSTs to `/api/v1/cloud/packages` for idempotent package upsert.
  4. POSTs to `/api/v1/cloud/packages/:id/versions` to publish the bundle
     as a new `sys_package_version` snapshot.
  5. Optionally auto-installs into a target env via `--env <id> --install`.
- Flags cover the full publish surface — `--manifest-id`, `--version`,
  `--display-name`, `--description`, `--category`, `--visibility`,
  `--org`, `--note`, `--pre-release`, `--seed-sample-data`, `--timeout`.
- Re-exported from `packages/cli/src/index.ts` as `PackagePublishCommand`.

Closes the user-facing half of the ADR-0006 v4 unified Package path: a
local code base can now land in the org Marketplace (or stay private)
without manual SQL or Console clicks. The legacy `objectstack publish`
command (writes `sys_environment_revision`) remains in place for
backward compatibility until the loader fully migrates.

### Changed — ADR-0006 v4: drop dev-workspace Project, unify deploy on Package

Removed the dev-workspace `sys_project` / `sys_project_branch` /
`sys_project_revision` concept introduced in v3. After scoping Phase 5 we
confirmed every Project responsibility is already covered by
`sys_package` + `sys_package_version` + `sys_package_installation`
(ADR-0003), so maintaining a parallel tree would create two competing
version-management spines.

CLI `objectstack publish` will be rewired to create a `sys_package_version`
and upsert a `sys_package_installation` row (Phase B of v4). The local dev
workspace is now just "local files + git" — no server-side row.

**Spec / schema side**
- Deleted `packages/spec/src/cloud/project.zod.ts` and dropped its export
  from `packages/spec/src/cloud/index.ts`. `ProjectSchema`,
  `ProjectBranchSchema`, `ProjectRevisionSchema` and their helpers are no
  longer exported.
- Trimmed the corresponding `describe` blocks from
  `packages/spec/src/cloud/environment.test.ts`.
- `packages/spec/src/cloud/environment.zod.ts` docstring updated to point
  at ADR-0006 v4 and stop referencing the deleted `project.zod.ts`.
- `packages/services/service-tenant/src/objects/sys-environment-revision.object.ts`
  marked `@deprecated transitional`; the file remains so the existing CLI
  publish HTTP path keeps compiling, and the index re-exports it with a
  comment explaining it will be removed in Phase D.
- `packages/services/service-tenant/src/objects/sys-project-revision.object.ts`
  and `sys-project-branch.object.ts` (dormant Phase 5 placeholders) were
  previously deleted in the same cleanup pass.

**Docs**
- Added `docs/adr/0006-project-environment-split.v4.md` describing the
  unified Package model and the four-phase rollout (A protocol cleanup
  now → B CLI rewire → C command split → D table removal).
- Marked v3 (`docs/adr/0006-project-environment-split.md`) as
  *Superseded by v4*.

### Added — M10.34 first-class custom action: "Invite User" on `sys_user` ✨

`sys_user` is `managedBy: 'better-auth'`, so generic CRUD is correctly suppressed (no New/Edit/Delete) — but Setup admins still need a way to add a user. Instead of routing them to a soon-to-be-deprecated organization-members page, we declare a proper schema action that opens a real inline modal and POSTs to the better-auth invite endpoint.

This unblocks "the basic need: add a user to Setup" using the platform's native action system — no bespoke pages, no custom React, no per-object handlers. The same pattern is the canonical answer for every `managedBy: 'X'` table needing custom CRUD-like affordances (Revoke Session, Reset Password, Rotate API Key, …).

**Spec / schema side**
- Added `actions: [{ name: 'invite_user', label: 'Invite User', icon: 'user-plus', variant: 'primary', locations: ['list_toolbar'], type: 'api', target: '/api/v1/auth/organization/invite-member', successMessage: 'Invitation sent', refreshAfter: true, params: [{ name: 'email', label: 'Email', type: 'email', required: true }, { name: 'role', label: 'Role', type: 'select', required: true, defaultValue: 'member', options: [{label:'Member',value:'member'},{label:'Admin',value:'admin'},{label:'Owner',value:'owner'}] }] }]` to `sys_user.object.ts`.
- `params: ActionParam[]` triggers the existing `paramCollectionHandler` → renders the generic `ActionParamDialog` (already shipped) — no new dialog code required.

**Console side**
- Extended `ObjectView.apiHandler` so `type: 'api'` actions whose `target` starts with `/` or `http(s)://` bypass `dataSource.execute()` and go through `authFetch()` directly. This is the path for cross-package endpoints (better-auth, future external service actions) where the relational-row protocol does not apply.
  - Sends `Authorization: Bearer <token>`, `X-Tenant-ID: <active org>`, and same-origin cookies automatically.
  - Auto-injects `organizationId` from `useAuth().activeOrganization` when the body doesn't already specify it.
  - Surfaces server error messages from the response body (`{error}` / `{message}`) in the failure toast.
- Threaded `activeOrganization` into `ObjectView`'s `<ActionProvider>` context so future CEL predicates / templates can reference it.

**Verified end-to-end** at `/console/apps/setup/sys_user` as a non-admin owner (Linda):
1. Toolbar shows a single primary "Invite User" button (no New / Import — those remain suppressed by the managed-by affordance gate).
2. Click → modal opens with `Email` + `Role` fields rendered from `action.params`.
3. Submit `newhire@acme-trading.test` / `member` → success toast `Invitation sent`.
4. `sys_invitation` row created: `email=newhire@acme-trading.test, role=member, status=pending, inviter_id=<Linda>, organization_id=<active org>`.

### Fixed — M10.33 dedup duplicate list-view tabs on Setup objects 🐛
Several `sys_*` objects (`sys_user`, `sys_organization`, `sys_role`, `sys_session`, `sys_audit_log`) showed two near-identical list-view tabs — e.g. `Users` *and* `All Users` on `sys_user/view/users` vs `sys_user/view/all_users`. The schema-derived view had correct columns; the duplicate `Users` view referenced fields that don't exist on `sys_user` (phone/status/active) and rendered an empty grid.

Root cause: `plugin-auth` was registering six legacy top-level `ListView` objects (`UsersView`, `OrganizationsView`, `RolesView`, `SessionsView`, `AuditLogsView`, `PackageInstallationsView`) via the manifest service. These predate the M10.30b–c work that moved list-view definitions onto each schema's `listViews` map. Both sets now flowed into `/api/v1/meta/view?objectName=X`, so the console merged them and surfaced both as tabs. One of the legacy views (`package_installations`) even targeted a `sys_package_installation` object that no longer exists.

- Removed the `views: [UsersView, …]` block from `plugin-auth/src/auth-plugin.ts`.
- Deleted `packages/platform-objects/src/apps/views/` (6 view files + their barrel).
- Schema-embedded `listViews` is now the single source of truth for these objects:
  - `sys_user.listViews`: `all_users` / `unverified` / `two_factor`
  - `sys_organization.listViews`: `all_orgs`
  - `sys_role.listViews`: `active` / `default_roles` / `custom` / `all_roles`
  - `sys_session.listViews`: `mine` / `all_sessions`
  - `sys_audit_log.listViews`: `recent` / `writes_only` / `auth_events` / `config_changes` / `all_events`
- Verified end-to-end via browser at `/console/apps/setup/{sys_user,sys_organization,sys_role,sys_audit_log}` — each page now renders exactly the schema-defined tabs with correct columns.

### Fixed — M10.32 honest UX: suppress broken generic CRUD on `sys_approval_process` & `sys_sharing_rule` 🐛
The Studio list pages for these two `managedBy: 'config'` objects exposed New/Import/Edit buttons, but the forms behind them rendered `definition_json` / `criteria_json` as raw textareas — admins were expected to hand-write multi-page Zod envelopes to author an approval process or sharing rule. Not usable for any real business user.

- Added `userActions: { create: false, edit: false, delete: false, import: false }` override on both schemas. The console (which already gates on `resolveCrudAffordances()` per M10.30b) now hides the affordances.
- Updated the schema `description` on both to direct authors to the real long-term path: `defineApprovalProcess({...})` / `defineSharingRule({...})` in code, seeded via the service endpoints (`POST /api/v1/approvals/processes`, `POST /api/v1/sharing/rules`).
- A visual designer for both objects is on the roadmap; the list views still surface segmented tabs (Active / Inactive / By Object / All) so admins can audit existing definitions, and per-row Active toggles will be added as inline actions in a follow-up.
- Verified in browser: list pages now render the "Admin config" banner with filter/group/sort toolbar only — no New/Import buttons. Identical pattern to the existing `system` / `append-only` buckets.

### Fixed — M10.30e ObjectQL: `applySystemFields` now applies to managed tables 🐛
`packages/objectql/src/registry.ts`: `applySystemFields` was early-returning for **every** table with `managedBy` set (admin/append-only/platform/config/system). That meant `sys_audit_log`, `sys_activity`, `sys_approval_action`, `sys_email`, `sys_presence`, etc. never received the implicit `organization_id` column in their in-memory schema, even though the physical DB columns existed. Downstream, SecurityPlugin's field-existence safety net (security-plugin.ts:303-319) dropped the wildcard `tenant_isolation` policy as "field missing on object" → `RLS_DENY_FILTER` → 0 rows for any non-admin member, regardless of writer fixes.

- Narrow the skip to only `managedBy === 'better-auth'` (whose tables have their own migration logic and cannot tolerate framework auto-columns).
- All other managed buckets — `admin`, `append-only`, `platform`, `config`, `system` — now correctly receive `organization_id` / `tenant_id` / audit columns in their schema.
- Verified: `GET /api/v1/data/sys_audit_log` as Linda (a non-admin member in `org_mpbxw2dqzdcrvsw6`) now returns her org's 2 rows. Previously returned 0. Combined with the M10.30d writer fix, this lights up the Setup → Overview "Recent Events" dashboards end-to-end for non-admin users.

### Fixed — M10.30d audit-log writer now stamps `organization_id` 🐛
The audit writer in `packages/plugins/plugin-audit/src/audit-writers.ts` was inserting `sys_audit_log`, `sys_activity` and `sys_notification` rows with `tenant_id` populated but **NULL `organization_id`** — the platform-default tenant column that RLS gates reads on. As a result every non-admin member's `tenant_isolation` policy denied 1900+ historical audit rows, so the new Recent Events table widgets on the System/Security Overview dashboards rendered "暂无数据" even when activity existed in their org.

- Both `auditRow` and `activityRow` now stamp `organization_id: tenantId` in addition to the existing `tenant_id` field.
- `writeAssignmentNotifications` and `writeCommentMentions` now also stamp `organization_id` so the recipient's RLS resolves the notification within their own tenant scope.
- Verified end-to-end: a `POST /api/v1/data/contact` as Linda (a Marketing manager in org_mpbxw2dqzdcrvsw6) now produces a `sys_audit_log` row with that exact `organization_id`, where previously it would have been NULL. Existing rows (NULL org) remain hidden by RLS; this is intentional — backfilling historical rows without a known org context would be unsafe.

Note: surfacing audit data to non-admin roles via the Setup dashboards is a separate permission-set concern (member_default has no `sys_audit_log` read grant yet). The writer fix unblocks the downstream RLS check; the role grant can be added when the audit-on-dashboard UX is prioritized.

### Added — M10.30c listViews coverage + dashboard cleanup 🎯
Followup to M10.30b. Closes the remaining listViews gaps on Setup-visible objects and repairs the two Overview dashboards (whose widget filters were never correct).

- **listViews extension** (6 schemas):
  - `sys_api_key`: My Keys (filtered to `user_id={current_user_id}`) / Active (`revoked=false`) / Revoked / All
  - `sys_record_share`: Granted to Me / Granted by Me / By Object (grouped) / Manual Grants / Rule Grants / All
  - `sys_oauth_application`: Active (`disabled=false`) / Disabled / All
  - `sys_two_factor`: My Enrollment / All
  - `sys_account`: My Links / By Provider (grouped) / All
  - `sys_user_preference`: My Preferences / By User (grouped, collapsed) / All
- **Dashboard fixes** — `apps/dashboards/{system,security}_overview.dashboard.ts`:
  - **Filter shape corrected** — every widget `filter` was using the list-view shape `{ field, operator, value }` which the analytics layer parses as three separate field equalities (e.g. literally `WHERE field='action' AND operator='equals' AND value='login'`), so every filtered metric silently returned 0. Migrated all widget filters to canonical MongoDB-style `FilterCondition` (e.g. `{ action: 'login' }`, `{ action: { $in: [...] } }`).
  - **Misleading title removed** — "Failed Login Attempts" → "Login Events". The `sys_audit_log.action` enum doesn't distinguish failed vs successful logins (both are `'login'`); the previous title overstated what the widget showed.
  - **Broken relative-date filter dropped** — `{ field: 'created_at', operator: 'gte', value: 'NOW() - INTERVAL 7 DAY' }` was a literal string the analytics layer never substituted. The dashboard's bottom date-range bar (`globalFilters`) is the supported way to scope; pie/bar widgets now rely on it.
  - **Duplicate "Recent X Events" metric panels** (which previously rendered the same total count twice on each dashboard) replaced with real `type: 'table'` widgets that pull rows from `sys_audit_log` via `ObjectDataTable`.

### Added — M10.30b Setup app audit + listViews batch 🎯
Followup to M10.30a. Walked every Setup menu in a real tenant; produced verdict matrix; shipped the safe fixes plus structural cleanup.

- **`packages/platform-objects/src/apps/setup.app.ts`** — sidebar trimmed from 7 groups / 41 menus → 6 groups / 26 menus with no loss of capability:
  - Removed 5 M:N join-table menus (Department Members, Team Members, Org Members, User Permission Sets, Role Permission Sets) — these are tabs on parent records, not entry points.
  - Removed 3 marketplace-only menus (Apps, Packages, Installations) which only render when `@objectstack/service-tenant` is loaded; in single-project runtimes they 404'd.
  - Removed 3 OAuth satellite menus (Access Tokens, Refresh Tokens, Consents); they live under their parent OAuth Application detail.
  - Removed Activity + Comments from Diagnostics; both are CRM operational data, not platform admin surfaces.
  - Demoted "All Metadata" from a top-level Platform group to Advanced/debug. Platform group is now empty and removed.
  - Renamed "Linked Accounts" → "Identity Links" to disambiguate from sys_user / org members.
- **listViews extension** — mirroring the M10.30a pattern, the following sys_* schemas now ship curated, segmented views:
  - `sys_user`: All Users / Unverified / 2FA Enabled
  - `sys_role`: Active / Default / Custom / All
  - `sys_permission_set`: Active / Inactive / All
  - `sys_invitation`: Pending / Accepted / Expired-Canceled / All
  - `sys_session`: My Sessions / All
  - `sys_sharing_rule`: Active / Inactive / By Object / All
  - `sys_department`: Active / Inactive / By Kind / All
  - `sys_team`: By Organization / All
  - `sys_organization`: All (curated columns)
- **Classification fixes** (correctness):
  - `sys_metadata` — `managedBy: 'config'` → `'system'`. The metadata table backs every typed config object; writing raw rows here bypasses Zod validation. The list page now correctly hides the New button (Export-only).
  - `sys_user_preference` — `managedBy: 'platform'` → `'system'`. Per-user state authored from the user's own settings page; the admin list is a support/diagnostic surface only. New + Import buttons are now correctly hidden.

### Fixed — Per-user RLS for better-auth tables (unblocks `sys_session` list) 🛡️
- **`packages/platform-objects/src/security/default-permission-sets.ts`** — added 10 per-object `*_self` RLS policies to `member_default` (and SELECT-only mirrors to `viewer_readonly`) covering every better-auth-owned table that has a `user_id` column but no `organization_id`: `sys_session`, `sys_account`, `sys_team_member`, `sys_two_factor`, `sys_user_preference`, `sys_api_key`, `sys_device_code`, `sys_oauth_access_token`, `sys_oauth_refresh_token`, `sys_oauth_consent`.
- **Root cause** — the wildcard `tenant_isolation` policy (`organization_id = current_user.organization_id`) is fail-closed: when the target field doesn't exist on the object, the RLS injector treats the policy as `RLS_DENY_FILTER` (zero rows visible) unless a per-object policy contributes an alternate match. Better-auth tables key on `user_id`, not `organization_id`, so all 10 listed above silently DENY'd for `member_default` / `viewer_readonly`, making the corresponding Setup menus show "No items found" even when rows existed. The fix mirrors the existing `sys_user_self` / `sys_organization_self` carve-outs.
- Verified: after rebuild, Linda (member_default) sees her 4 sessions and 1 account on the respective Setup pages; admin (admin_full_access, no RLS) continues to see all rows.

### Added — M10.30 Built-in list views for system objects 🎯
- **`packages/spec/src/data/object.zod.ts`** — added optional `listViews?: Record<string, ListViewSchema>` to `ObjectSchemaBase`. Already consumed by the console's `ObjectView`; previously dead because no schema declared it (Zod was stripping unknown keys). Authors can now bundle curated, segmented list views directly with the object definition.
- **`packages/platform-objects/src/audit/sys-approval-request.object.ts`** — ships 4 views: `my_pending` (`status=pending AND pending_approvers contains {current_user_id}`, sort `updated_at desc`), `submitted_by_me` (`submitter_id={current_user_id}`), `completed` (`status in approved/rejected/recalled`, sort `completed_at desc`), `all_requests`.
- **`packages/platform-objects/src/audit/sys-approval-process.object.ts`** — ships 4 views: `active` (`active=true`), `inactive`, `by_object` (grouped by `object_name`), `all_processes`.
- **`packages/platform-objects/src/audit/sys-approval-action.object.ts`** — ships 3 views: `recent` (sort `created_at desc`), `by_actor` (grouped), `all_actions`.
- **`packages/platform-objects/src/audit/sys-audit-log.object.ts`** — ships 5 views: `recent`, `writes_only` (create/update/delete/restore), `auth_events` (login/logout/permission_change), `config_changes` (config_change/export/import), `all_events`.
- **`packages/platform-objects/src/audit/sys-notification.object.ts`** — ships 3 views: `unread` (`recipient_id={current_user_id} AND is_read=false`), `mine` (`recipient_id={current_user_id}`), `all_notifications`.
- **Rationale** — every `sys_*` page in the console previously fell back to a synthetic "All records" grid with no sort, no segmentation, no curated columns. For audit / runtime / config objects that's not just unhelpful — it's actively misleading (an approver opening `sys_approval_request` saw every tenant's history in insertion order instead of *their* pending queue). Following Salesforce/ServiceNow patterns, these system tables now ship with role-aware default views out of the box, and `managedBy: 'config' | 'system' | 'append-only'` continues to gate the toolbar (no New/Import on engine-managed rows).
- **Token substitution** — `@object-ui/app-shell` `ObjectView.tsx` now substitutes `{current_user_id}` inside any filter at query time (applies to platform-shipped `listViews` *and* user-saved `sys_view` rows), so user-scoped views like "My Pending" actually scope to the current user instead of returning the literal token string.

### Changed — REST capability routes promoted to top-level ⭐ BREAKING
- **`packages/rest/src/rest-server.ts`** — `approvals/*`, `sharing/rules/*`, and `reports/*` REST endpoints moved from `/api/v1/data/{capability}/...` → `/api/v1/{capability}/...`. These are tenant-wide capabilities (not records on a CRUD object), so nesting them under `/data/` (which is reserved for ObjectQL CRUD on `:object/:id`) was misleading and produced a confusing surface where `/data/approvals` looked like a `sys_approvals` object table. Scoped variants under `/api/v1/projects/:projectId/{capability}/...` are auto-registered the same way.
- **Per-record `/:object/:id/shares`** stays under `/data/` because it *is* scoped to a CRUD record. Only the tenant-wide rule/process/report admin surface moved.
- **Affected paths** (old → new):
  - `POST /api/v1/data/approvals/processes` → `POST /api/v1/approvals/processes` (+ 10 other approval routes)
  - `GET /api/v1/data/sharing/rules` → `GET /api/v1/sharing/rules` (+ 4 other rule routes)
  - `POST /api/v1/data/reports` → `POST /api/v1/reports` (+ 7 other report routes)
- **Consumer updates** — `@object-ui/console` `approvalsApi.ts` rebased on `/api/v1` (not `/api/v1/data`); `@object-ui/app-shell` `AppHeader.tsx` pending-approvals badge fetch URL updated.
- **Migration** — find/replace `/api/v1/data/approvals` → `/api/v1/approvals`, `/api/v1/data/sharing/rules` → `/api/v1/sharing/rules`, `/api/v1/data/reports` → `/api/v1/reports` in any external clients. Old paths return 404 (no compat shim — `/data/:object` would otherwise treat e.g. `approvals` as a sys-approvals record id).

### Changed — M10.28 Setup app reorganization ⭐
- **`packages/platform-objects/src/apps/setup.app.ts`** — sidebar restructured from 5 ad-hoc groups into 7 semantic groups that mirror how admins actually think about identity & access:
  - **Overview** — unchanged (`system_overview` / `security_overview` dashboards).
  - **People & Organization** *(new)* — Users · Departments · Department Members · Teams · Team Members · Organizations · Org Members · Invitations. Co-locates the M10.17.1 `sys_department` + `sys_department_member` with better-auth's flat `sys_team` and `sys_member`, so the org-chart workflow (add user → assign to department → optionally join a team) is one continuous click path.
  - **Access Control** *(renamed from "Administration")* — Roles · Permission Sets · User Permission Sets · Role Permission Sets · Sharing Rules · Record Shares · API Keys. Brings M10.17 `sys_sharing_rule` + `sys_record_share` out of the "All Metadata" abyss.
  - **Approvals** — unchanged (M11.C15 surface).
  - **Platform** — control-plane metadata (`sys_app` / `sys_package` / `sys_package_installation` / `sys_metadata`), unchanged.
  - **Diagnostics** *(renamed from "System")* — Sessions · Audit Logs · Activity · Notifications · Comments. Operational surfaces grouped together.
  - **Advanced** *(new, collapsed by default via `expanded: false`)* — OAuth Apps · OAuth Access Tokens · OAuth Refresh Tokens · OAuth Consents · Signing Keys (JWKS) · Verifications · Two-Factor · Device Codes · Linked Accounts · User Preferences. Moves 10 better-auth internals out of the daily admin sightline; they're still one click away for support engineers but no longer noise.
- **Rationale** — 17 of 20 identity tables are `managedBy: 'better-auth'`; the previous "Administration" dump mixed HR-shaped operations (Users / Teams) with debugging-grade internals (JWKS / OAuth tokens). Splitting along the platform-vs-managed boundary makes the most common workflows (hiring, role assignment, sharing-rule authoring) discoverable, and de-emphasizes tables that should rarely need human editing.

### Added — M10.17.1 dedicated org-skeleton (`sys_department`) ⭐
- **Architectural split** — better-auth's `sys_team` is now used *only* for flat collaboration groupings (matching the upstream contract). The enterprise org chart moves to a dedicated **`sys_department`** + **`sys_department_member`** pair (`packages/platform-objects/src/identity/`). This removes the M10.17 overload where `sys_team.parent_team_id` was doing double duty and risks colliding with future better-auth schema changes.
- **`sys_department`** — recursive (`parent_department_id` self-lookup), tenant-scoped (`organization_id`), with `kind` enum (`company | division | department | team | office | cost_center`), `manager_user_id` for department head, `active` flag, effective-dated (`effective_from` / `effective_to`), and `external_ref` for HRIS sync (Workday / SAP HR / 北森).
- **`sys_department_member`** — many-to-many user ↔ department supporting matrix orgs (multiple memberships per user, one `is_primary`), `role_in_department` (`member | lead | deputy`), and effective dates so historical reports can reconstruct who reported where.
- **Schema cleanup** — dropped `sys_team.parent_team_id` (better-auth contract restored to vanilla); both new schemas registered automatically by `SharingServicePlugin.init()`.
- **`DepartmentGraphService implements IDepartmentGraphService`** — new file `packages/plugins/plugin-sharing/src/department-graph.ts`. BFS over `parent_department_id` (active-only — inactive subtrees stop descent), `expandUsers` via `sys_department_member`, `headOf` reads `manager_user_id`, proxies `managerOf` to `TeamGraphService` so callers need only one service.
- **`TeamGraphService` flattened** — removed the BFS descendant walk; `expandUsers(teamId)` now returns flat members of one `sys_team`. Added a top-level `expandPrincipal(input, ctx)` helper that dispatches `user | team | department | role | manager | field | queue` to the right service (legacy `team:`/`role:`/`manager:` substring fallback retained for back-compat).
- **`SharingRuleService.expandRecipient`** — now routes `recipient_type='department'` through `DepartmentGraphService`. `sys_sharing_rule.recipient_type` enum bumped to `'user' | 'team' | 'department' | 'role' | 'queue'` (default flipped from `team` → `department` to nudge users toward the org skeleton).
- **`ApproverType` extended** — `packages/spec/src/automation/approval.zod.ts` adds `'team'` and `'department'` to the enum (previously only `'role'` covered grouped approvers).
- **`ApprovalService.expandApprovers`** — `team:` is now flat (was previously walking `parent_team_id`); new `department:` / `dept:` prefix walks `sys_department` BFS + members via `sys_department_member`; `role:` / `manager:` / `field:` / `user:` unchanged. Unknown / missing-row fallbacks still echo `type:value` for legacy storage compatibility.
- **Contracts (`@objectstack/spec/contracts/sharing-service.ts`)** — added `IDepartmentGraphService`; `ITeamGraphService` reduced to flat semantics (`descendants` removed); `SharingRuleRecipientType` includes `'department'`.
- **Tests** — 47/47 (`plugin-sharing` — 20 sharing-rule incl. dept-rule reconcile + 27 share enforcement, with 6 new tests covering BFS / inactive-subtree skip / cross-tenant guard / head lookup / dispatcher fallback), 32/32 (`plugin-approvals` — 3 new tests: flat team expansion, dept BFS expansion, dept fallback to prefixed literal), 74/74 (`rest`), 85/85 (`platform-objects`).
- **Migration note** — any caller that wrote to `sys_team.parent_team_id` in M10.17 needs to migrate that data into `sys_department`; sharing rules with `recipient_type='team'` that previously relied on team hierarchy must either flatten or be switched to `recipient_type='department'`.

### Added — M10.17 declarative sharing rules + team hierarchy ⭐
- **`sys_sharing_rule`** — new tenant-scoped object (`packages/platform-objects/src/security/sys-sharing-rule.object.ts`) describing "any record of object O matching FilterCondition C is granted access level A to recipient R (user/team/role/queue)". Salesforce-style criteria-based sharing, with criteria stored as a JSON `FilterCondition` so the engine's native `find()` can evaluate matches without a separate predicate runtime.
- **Team hierarchy (`sys_team.parent_team_id`)** — added an optional self-lookup to `sys_team` so descendants can be walked into a flat user set. `sys_team` continues to conform to better-auth's organization plugin schema (extension columns are ignored by better-auth selects).
- **`@objectstack/plugin-sharing` — sharing-rule subsystem** — three new modules behind the existing `SharingServicePlugin`:
  - `team-graph.ts` — `TeamGraphService implements ITeamGraphService`. Cached descendant walk over `sys_team`, member expansion via `sys_team_member`, role expansion via `sys_member.role`, manager lookup via `sys_user.manager_id`, and an `expandPrincipal({type,value,record})` dispatcher for `user|team|role|manager|field|queue` recipient kinds. All queries elevate to `SYSTEM_CTX`.
  - `sharing-rule-service.ts` — `SharingRuleService implements ISharingRuleService` with `defineRule` (upsert by `(name, organization_id)`), `listRules({object?,activeOnly?})`, `getRule(idOrName)`, `deleteRule` (purges materialised grants), `evaluateRule(id)` (bulk reconcile — diffs desired vs existing `sys_record_share` rows where `source='rule' AND source_id=rule.id` and creates/updates/revokes accordingly), and `evaluateAllForRecord(object, recordId)` (per-record incremental called from lifecycle hooks).
  - `rule-hooks.ts` — `bindRuleHooks` registers `afterInsert` + `afterUpdate` hooks per distinct `object_name` of active rules (skips engine self-writes via `ctx.session.isSystem`); auto-bound on `kernel:ready` and re-bindable via `unbindAllRuleHooks` for hot reload.
- **Approval-engine integration** — `ApprovalService.expandApprovers()` now resolves `team:` / `role:` / `manager:` approver types into real user IDs via the same team-graph queries (`sys_team`/`sys_team_member`/`sys_member`/`sys_user`), with graceful fallback to the legacy prefixed-string format when graph lookups return empty. Swapped in at every callsite that previously called `resolveApprovers()`: initial submit, step advancement (`approve` next step), and `reject` back-to-previous + unanimous vote reconciliation.
- **REST surface (5 endpoints)** — `packages/rest/src/rest-server.ts` registers `GET/POST /api/v1/data/sharing/rules` (list + upsert), `GET/DELETE /api/v1/data/sharing/rules/:idOrName` (read + delete with grant purge), and `POST /api/v1/data/sharing/rules/:idOrName/evaluate` (bulk re-evaluation). Wired through `rest-api-plugin.ts` via a new `sharingRulesServiceProvider` resolving the `sharingRules` service registered by the plugin; returns `501 NOT_IMPLEMENTED` cleanly when the plugin is absent.
- **CLI auto-loading** — CRM example's `objectstack.config.ts` `requires` now includes `'sharing'` so `packages/cli/src/commands/serve.ts` auto-loads the plugin and the rule service appears at `/api/v1/data/sharing/rules`.
- **Contracts (`@objectstack/spec/contracts/sharing-service.ts`)** — added `ISharingRuleService`, `ITeamGraphService`, `SharingRuleRow`, `DefineSharingRuleInput`, `SharingRuleEvaluationResult`, `SharingRuleRecipientType`.
- **Tests** — 42/42 (`plugin-sharing` — 15 new rule/graph tests + 27 existing share enforcement tests), 29/29 (`plugin-approvals`), 74/74 (`rest`), 85/85 (`platform-objects`).

### Added — M11.C15 multi-step approval engine ⭐
- **`sys_approval_process` / `sys_approval_request` / `sys_approval_action`** — three tenant-scoped audit-style objects (`packages/platform-objects/src/audit/`) backing a full approval engine. Process definitions are persisted as JSON envelopes validated by `ApprovalProcessSchema` (`@objectstack/spec/automation/approval`); request/action rows carry an `organization_id` lookup so the bespoke `/approvals/*` REST surface stays tenant-isolated even when the service bypasses RLS for CSV substring matching on `pending_approvers`.
- **`@objectstack/plugin-approvals`** — new workspace plugin (`packages/plugins/plugin-approvals/`) wiring `ApprovalService implements IApprovalService` (`packages/spec/src/contracts/approval-service.ts`). Supports `defineProcess` / `listProcesses` / `submit` / `approve` / `reject` / `recall` / `listRequests` / `getRequest` / `listActions`. Step `behavior: 'unanimous' | 'first_response'` and `rejectionBehavior: 'final' | 'back_to_previous'` honoured; `DUPLICATE_REQUEST` guard prevents two pending requests against the same `(object, recordId)`.
- **Phase B autopilot** — `lifecycle-hooks.ts` binds `afterInsert` / `afterUpdate` / `beforeUpdate` hooks for every object referenced by an active process. `entryCriteria` (CEL) evaluation auto-submits; mirror `approvalStatusField` is written through; `recordLock` mode locks edits while a request is pending (admin role override surfaces silent success — see Open Question below). `onSubmit` / `onApprove` / `onReject` post-actions fire feed entries + assignments.
- **REST surface (11 endpoints)** — `packages/rest/src/rest-server.ts:2530-2663` registers `GET/POST/DELETE /api/v1/data/approvals/processes[/:id]`, `POST /api/v1/data/approvals/requests` (submit), `GET /api/v1/data/approvals/requests` (list with `?status&approverId&object&recordId&submitterId` filters), `GET/POST` per-request approve / reject / recall / actions. Error model: `VALIDATION_FAILED` (400), `PROCESS_NOT_FOUND` / `REQUEST_NOT_FOUND` (404), `DUPLICATE_REQUEST` / `INVALID_STATE` (409), `FORBIDDEN` (403), `NO_ACTIVE_PROCESS` (404).
- **Console nav surfacing** — `packages/platform-objects/src/apps/setup.app.ts` exposes "Approvals" (Processes / Requests / Action History) above the System group; `examples/app-crm/src/apps/crm.app.ts` mirrors the same group on the CRM sidebar using new `nav.requiresObject` opt-out so cross-stack object references no longer fail the stack validator (`packages/spec/src/stack.zod.ts:552`).
- **Tenant-isolation fix (commit `5a0d4f80`)** — `submit()` populates `organization_id` from `ctx.organizationId ?? ctx.tenantId`; auto-trigger propagates `ctx.session.tenantId` into the SYSTEM_CTX it hands to `submit()`; `listRequests` / `getRequest` / `listActions` scope by tenant when the caller carries one (SYSTEM callers still see all rows). End-to-end verified against the CRM example with two tenants: each user only sees their own pending requests; cross-tenant `getRequest` returns `404 REQUEST_NOT_FOUND`.
- **Tests** — 29/29 (`plugin-approvals`), 74/74 (`rest`), 85/85 (`platform-objects`), 6836/6836 (`spec`).

### Added — M11.C16 saved reports + matrix aggregation
- **`@objectstack/plugin-reports`** — full saved-report service with scheduled email digests (committed earlier; see commit `c5c3232c`).
- **`ObjectQL.aggregate()` structured `groupBy` bypass** (`packages/objectql/src/engine.ts`) — when any `groupBy` item is structured (e.g. `{field, dateGranularity: 'day'|'week'|'month'}`) the engine bypasses the driver-level aggregate path and falls back to the in-memory bucket+aggregate path, which is the only one that knows how to truncate dates portably across SQLite / Postgres / Turso.
- **`COUNT(*)` support in `SqlDriver.aggregate`** (`packages/plugins/driver-sql/src/sql-driver.ts`) — `field` is now optional for `COUNT`; when omitted (or `'*'`) the driver emits `COUNT(*)` instead of binding `??` to an empty identifier.

### Added — Cloud control plane: Postgres driver support ⭐
- **`buildControlDriver` in `@objectstack/service-cloud/cloud-stack.ts`** now recognises `postgres://`, `postgresql://`, and `pg://` URLs and dispatches them to `@objectstack/driver-sql` with `client: 'pg'`. Previously only `libsql:` / `https:` (Turso) and `file:` (SQLite) were recognised, so a `postgres://…` value was silently rewritten into a SQLite filename — a particularly nasty data-routing bug in production. The function now eagerly `import('pg')` so a missing-driver situation surfaces with an explicit, actionable error at boot.
- **Pool sizing knobs**: `OS_CONTROL_PG_POOL_MIN` (default `0`) and `OS_CONTROL_PG_POOL_MAX` (default `10`) tune the knex `pg` pool without code changes.
- **`pg` promoted to a runtime dependency of `apps/cloud`** so `pnpm deploy --prod` ships it inside the Docker image; image size unchanged at ~691 MB.
- **`.env.cloudflare.secrets.example`, `setup-cloudflare-secrets.sh` (cloud + objectos), and `apps/cloud/README.md`** updated with the new env vars and a "Postgres in production" section that covers Neon / Supabase / RDS / Hyperdrive guidance.
- **End-to-end verified**: `docker run` with `OS_CONTROL_DATABASE_URL=postgres://os:test@pg-test:5432/cloud` boots cleanly, `/api/v1/health` returns 200, and the full `sys_*` control-plane schema (Accounts, Activity, Agent, API Keys, Apps, Audit, Flows, OAuth, Organization, Packages, …) is materialised in Postgres on first boot.

### Changed — Slimmer production Docker images (`apps/objectos`, `apps/cloud`)
- **3-stage builder → pruner → runner Dockerfiles**: full pnpm workspace is restored only in the builder; the pruner runs `pnpm --filter ... deploy --prod --legacy /deploy` to materialize a flat, devDeps-stripped tree; the runner copies just `/deploy` plus the freshly built `dist/` of the target app. CMD now runs `node node_modules/@objectstack/cli/bin/run.js serve dist/objectstack.config.js --prebuilt` directly — no `pnpm` at runtime.
- **`@objectstack/cli` promoted to `dependencies`** in both `apps/objectos/package.json` and `apps/cloud/package.json` so the production entrypoint survives `--prod` pruning.
- **Surgical `.pnpm/` pruning** in the pruner stage removes large transitive packages that are not exercised by the runtime path (`next`, `@next/swc-*`, `playwright-core`, `@playwright/*`, `typescript`, `happy-dom`, `@rolldown/*`, `@img/sharp-libvips-*`, `@cloudflare/workers-types`, `@esbuild/*`, `lightningcss-*`, `caniuse-lite`). Together with stripping `*.map`, test directories, and Markdown, this lands the final image at ~690 MB (down from 1.93 GB), a 64% reduction. Both images still pass `/api/v1/health` and Docker's HEALTHCHECK end-to-end.

### Added — Cloudflare Containers deployment for `apps/objectos` & `apps/cloud`
- **`apps/{objectos,cloud}/scripts/deploy-cloudflare.sh`** — Idempotent `build → push → deploy` pipeline. Reads config from `.env.cloudflare` (gitignored) or env vars; auto-tags images with the current git short SHA; in-place rewrites the `image = "..."` line in `wrangler.toml` (BSD/GNU sed compatible); supports `--tag`, `--skip-build`, `--skip-push`, `--skip-deploy`, `--dry-run`. Forces `--platform linux/amd64` (Cloudflare Containers requirement).
- **`apps/{objectos,cloud}/scripts/setup-cloudflare-secrets.sh`** — Bulk `wrangler secret put` from a local `.env.cloudflare.secrets` file. Per-app key allow-list lets one shared file feed both Workers; unset keys are skipped (not cleared). Safe to re-run.
- **npm scripts** in both apps: `cf:build`, `cf:push`, `cf:deploy`, `cf:deploy:dry`, `cf:secrets`, `cf:tail`.
- **`.env.cloudflare.example` + `.env.cloudflare.secrets.example`** templates per app, with all required keys documented and the real files added to each app's `.gitignore`.

- **`apps/cloud/Dockerfile` + `.dockerignore`** — Production multi-stage image mirroring `apps/objectos/Dockerfile` (Node 22, pnpm workspace builder, slim runtime). Defaults `PORT=4000` to match `pnpm dev`, sets `OS_DISABLE_CONSOLE=1`, builds `@objectstack/cloud...` and serves via `objectstack serve --prebuilt`.
- **`apps/{objectos,cloud}/wrangler.toml`** — Cloudflare Containers configs that wrap the production image in a Container-class Durable Object (`ObjectOSContainer` / `CloudContainer`) and front it with a fetch-forwarding Worker. Uses `instance_type = "standard-1"`, `nodejs_compat`, `[[migrations]] new_sqlite_classes`, and references a pre-pushed image tag (recommended workflow: `docker build` from repo root → `wrangler containers push` → `wrangler deploy`).
- **`apps/{objectos,cloud}/cloudflare/worker.ts`** — Tiny Worker entrypoint using `@cloudflare/containers`. Pinned single-instance routing (`getContainer(env.X, 'singleton')`), inline `envVars` block for non-secret runtime config; secrets (`OS_DATABASE_URL`, `OS_DATABASE_AUTH_TOKEN`, `AUTH_SECRET`, `TURSO_*`) are injected via `wrangler secret put`.
- **`@cloudflare/containers`, `@cloudflare/workers-types`, `wrangler` devDependencies** added to both apps. `tsconfig.cloudflare.json` provided per app for isolated Worker type-checking (the main `tsconfig.json` `include` deliberately excludes `cloudflare/**` to keep the Node build untouched).
- **README sections** in both apps document the build/push/secret/deploy workflow and call out that the control DB **must** point at remote libSQL/Turso — Cloudflare Containers' filesystem is wiped on cold-start.

### Added — Metadata runtime: caching, bootstrap modes, and write gates ⭐
- **`DatabaseLoader` read-through LRU cache** (`@objectstack/metadata`) — Wraps `load` / `loadMany` / `list` / `stat` results in a generic `LRUCache<K, V>` (lazy TTL, promote-on-get, hit/miss/hitRate stats) backed by `src/utils/lru-cache.ts`. Writes through the loader (`save`, `delete`) invalidate the affected `(type, name)` entries so reads always observe writes made via the same loader instance; out-of-band SQL writes are honored within `ttl` milliseconds. Configured under `MetadataManagerConfig.cache.databaseLoader = { enabled, maxSize, ttl }` and exposed via `LRUCache.stats()` for observability endpoints. Eliminates the per-request driver round trip that made datasource-backed metadata too expensive for hot ObjectQL paths.
- **`MetadataPlugin` bootstrap modes** (`@objectstack/metadata`) — `MetadataPluginConfigSchema.bootstrap` is now an enum: `eager` (default — preserves the historical filesystem scan), `lazy` (skips the FS priming pass entirely; reads flow through `MetadataManager.load*` / `list*` and registered loaders, including the DatabaseLoader cache; honors `artifactSource` if set), and `artifact-only` (refuses to touch the filesystem; requires `artifactSource.mode = 'local-file'` and throws otherwise). Unblocks Edge / serverless / read-only production deployments that must not depend on local source files at boot.
- **`MetadataManagerConfig.persistence` runtime write gates** (`@objectstack/metadata`) — Two-axis gate (`persistence.writable`, `persistence.overlayWritable`, both default `true`) that lets sealed kernels freeze metadata mutation while leaving reads open. With `writable: false`, `MetadataManager.register()` becomes a no-op (or throws under `validation.throwOnError`); with `overlayWritable: false`, `MetadataManager.saveOverlay()` is rejected. Suits read-only project kernels booted from a compiled artifact and fully-frozen production deployments that disable Studio overlays.
- **Single-source-of-truth metadata schema discipline** (`@objectstack/spec`) — Canonical `MetadataManagerConfigSchema` and `MetadataFallbackStrategySchema` now live exclusively in `packages/spec/src/kernel/metadata-loader.zod.ts` (carrying the richer shape: nested `cache.databaseLoader`, `persistence` block, `validation` block). `packages/spec/src/system/metadata-persistence.zod.ts` re-exports them so a single TypeScript type is observed everywhere `@objectstack/spec` consumers reach for it. Removes a duplicate-narrower-shape footgun that previously caused drift between the kernel-side runtime config and the persistence-side type.

### Added — M9.9 Spec-wide Expression coverage sweep ⭐
- **Two new dialect engines registered with `@objectstack/formula`**: `cron` and `template`. `cron-engine` validates 5/6-field cron + alias schedules (no parser dependency, schedule strings round-trip on evaluate); `template-engine` is a strict Mustache subset (`{{path.to.value}}` only, same variable scope as CEL — `record`, `previous`, `os.user`, `os.org`, `os.env`). Both are first-class peers of `cel` in `ExpressionEngine.evaluate`, fully replacing earlier stubs.
- **`CronExpressionInputSchema`, `TemplateExpressionInputSchema`** + new `cron\`...\`` and `tmpl\`...\`` tagged-template helpers in `@objectstack/spec`. Bare strings on cron/template fields normalize to the matching envelope (`{ dialect: 'cron' | 'template', source }`) at validate time so AI authors never have to remember which dialect to wrap in.
- **M9.9a — 5 bare predicates migrated to CEL**: `Workflow.Task.dueDate`, `GraphQL.ComputedField.expression`, `runtime-ops.customCondition`, `metadata-loader.filter` (×2), `Form.onSubmit`. All now flow through `ExpressionInputSchema`.
- **M9.9b — `defaultValue` accepts Expression**: `Field.defaultValue` evaluation wired into `DataEngine.insert` (both bulk and single paths). When defaults are `{ dialect, source }`-shaped they are evaluated through `ExpressionEngine` with the per-insert pinned `now`, the resolved user/org from `ExecutionContext`, and the partially-defaulted record in scope. Replaces the "write a beforeInsert hook to default to today / current-user" anti-pattern with declarative `defaultValue: cel\`today()\`` / `cel\`os.user.id\``. Browser-verified end-to-end: a `quote` insert that omits `quote_date` arrives at the SQL driver with `quote_date` populated by `cel\`today()\``.
- **M9.9c — 10 cron-string sites unified**: `connector.schedule`, `disaster-recovery.schedule` (×2), `cache.schedule`, `etl.schedule`, `sync.schedule`, `execution.cronExpression`, `export.cronExpression` (×2), `orchestration.cron`, `devops-agent.iterationFrequency`, plus `Job.schedule.expression` made canonical. Factory helpers in `etl.zod.ts` / `sync.zod.ts` accept either a bare string (auto-wrapped) or a pre-built envelope so the `databaseSync({ schedule: '0 * * * *' })` DX still compiles.
- **M9.9d — `template` dialect adoption (12 sites)**: notification subject/body, SMS message, push body and message, GitHub PR/release templates (titleTemplate, bodyTemplate), AI prompt templates (model-registry system + user, agent-action subject + message, NLQ systemPrompt, MCP systemPrompt), `Object.titleFormat`, GraphQL `cache.key`. AI authors now have one rule: anything templated or computed goes through `Expression`.
- **M9.9e — Structured rule objects gain a CEL escape hatch**: `audit.condition`, `metrics.successCriteria` + `metrics.condition`, `tracing.condition` are now `z.union([structured, ExpressionInputSchema])`, so power users can drop down to raw CEL when the typed rule shape is too narrow.
- **CRM example fully migrated to CEL** via codemod: 14 object/sharing/view files (52 Salesforce-flavor `condition`/`criteria`/`visibleOn` strings), `quote.quote_date` switched from broken `'TODAY()'` literal to `cel\`today()\``, plus 12 flow-edge conditions rewritten from `{step.result}` template syntax to `vars.step.result` CEL identifier paths. `examples/app-todo` migrated alongside.
- **Flow runtime now routes CEL conditions through `@objectstack/formula`** (`@objectstack/service-automation`) — `FlowEngine.evaluateCondition` detects the `dialect: 'cel'` envelope, hydrates the variables Map into a nested `vars.*` object, and calls `ExpressionEngine.evaluate({ extra: { vars }, record: vars })`. Legacy bare-string `{varName}` template syntax remains supported for back-compat.

### Verified
- All 6840 spec tests pass; all 218 objectql tests pass; full repo `pnpm test` green across 100 task targets.
- CRM `objectstack build` byte-identical across two runs after the migration: SHA-1 `e2af9e57a869ab75721d00252b4e133e3a53f7f3` (vs the pre-M9.9 baseline of `91efccc…`; the new hash is the post-migration baseline).
- Browser-verified `cel\`today()\`` evaluation on insert via `pnpm dev:crm` REST POST.

### Added — M9 Expression Unification (CEL + AST-first) ⭐
- **New `@objectstack/formula` package** — Canonical expression engine wrapping [`@marcbachmann/cel-js`](https://github.com/marcbachmann/cel-js) (Apache-2.0). Provides `ExpressionEngine.evaluate(expr, ctx)` as the single entrypoint for every expression-shaped surface in metadata. Standard library ships `now()`, `today()`, `daysFromNow(n)`, `daysAgo(n)`, `isBlank(v)`, `coalesce(v, fallback)`, with the variable scope `record`, `previous`, `input`, `os.user`, `os.org`, `os.env`. The pinned-`now` design is what makes `objectstack build` deterministic.
- **`ExpressionInputSchema` envelope across spec** (`@objectstack/spec`) — Replaced ~25 untyped `z.string()` formula / condition / criteria / visibility fields with the canonical `Expression { dialect, source, ast?, meta? }` envelope. Surfaces migrated: `Field.formula`, `Field.conditionalRequired`, `Field.visibleOn`, `ConditionalValidation.when`, `ObjectFieldGroup.visibleOn`, `View.visibleOn`, `View.criteria`, `Action.disabled`, `Hook.condition`, `SharingRule.condition`, `Flow.decision.expression`. Bare strings remain accepted at input time and transform into `{ dialect: 'cel', source }`. New tagged-template helpers `cel\`...\``, `F\`...\``, `P\`...\`` exported from `@objectstack/spec` for ergonomic in-source authoring. Resolves D10.
- **Dynamic seed values** (`@objectstack/runtime` SeedLoader) — `Dataset.records` now accepts `cel\`...\`` expressions for fields whose value depends on the install-time clock or identity. SeedLoader walks records and evaluates expressions through `ExpressionEngine` with a single per-load pinned `now`, so package authors can ship `close_date: cel\`daysFromNow(45)\`` without baking their laptop's timestamp into the artifact. Determinism gate enforced via SHA-1 comparison of two consecutive `objectstack build` runs. Resolves D11.
- **CRM example migrated to CEL** (`examples/app-crm`) — All 4 formula fields (`lead.full_name`, `contact.full_name`, `campaign.response_rate`, `campaign.roi`) re-written in CEL using the `coalesce()` / ternary patterns. 48 dynamic-date seed values migrated from `new Date()` (compile-time) to `cel\`daysFromNow(N)\`` / `cel\`daysAgo(N)\`` (install-time). Browser-verified end-to-end via `pnpm dev:crm`: `Lead.full_name` renders "Lisa Thompson", `Campaign.roi` renders `1907.04` in the dashboard.
- **`planFormulaProjection` evaluates on default REST projection** (`@objectstack/objectql`) — Previously formulas were only computed when the caller passed an explicit `?fields=` projection. The REST default returns all columns but no formulas, so `Field.type === 'formula'` columns came back as `null` in the dashboard's auto-generated views. Fix: when `requestedFields` is empty/undefined, target every field in the schema for formula evaluation while leaving `projected` undefined so the driver still returns the default column set.
- **New `objectstack-formula` skill** ([`skills/objectstack-formula/SKILL.md`](skills/objectstack-formula/SKILL.md)) and rewritten [`content/docs/guides/formula.mdx`](content/docs/guides/formula.mdx) — Author-facing documentation of the canonical CEL contract: stdlib reference, mandatory patterns for AI emission, mechanical translation table from the legacy Salesforce-flavor DSL, and the determinism contract.

### Removed — M9 Expression Unification
- **Custom Salesforce-flavor formula engine** (`@objectstack/objectql`) — Deleted `packages/objectql/src/formula.ts` (433 LoC hand-written recursive-descent parser exposing 22 functions: `CONCAT`/`UPPER`/`IF`/`AND`/`OR`/`ISBLANK`/`TODAY`/…) and its companion `packages/spec/docs/formula-functions.md`. The engine had no formal grammar, no public training corpus, no AST persistence, and was a single-vendor surface. **Salesforce compatibility is not pursued** — see [north-star §8](content/docs/concepts/north-star.mdx) "No private expression DSL". Authors targeting Salesforce semantics rewrite their formulas in CEL using the translation table in the formula skill. Resolves D9.

### Added
- **Per-organization seed-data clone for new signups** (`@objectstack/plugin-security`) — In multi-tenant mode, when a user signs up after the very first user (whose org gets the seed via `claimOrphanTenantRows`), SecurityPlugin now copies the platform-first organization's user-defined data into the new user's personal workspace via `cloneTenantSeedData()`. Without this, every user-after-the-first landed on an empty dashboard — multi-tenant isolation is correctly enforced, so seed rows owned by the first org are filtered out by RLS for everyone else. Implementation: two-pass strategy — pass A inserts shallow row copies (lookup field values left as donor's old IDs) under the new `organization_id` and records `oldId → newId` per object; pass B walks each cloned record's lookup fields and rewrites values via the per-object remap so intra-clone foreign keys (e.g. `opportunity.account → account.id`) stay intact without needing topological insert ordering. Skips computed/virtual field types (`formula`, `summary`, `autonumber`) that have no underlying SQL column. Disambiguates `unique: true` columns with a per-tenant `clone-<orgsuffix>-` prefix so global UNIQUE indexes (e.g. `lead.email`) don't collide. Idempotent per-object — if the target org already has any row in an object, that object is skipped. Donor org is the oldest `sys_organization`. Best-effort: a per-object failure is logged at `warn` and never blocks signup. Wired via DI hook in `ensureUserHasOrganization` so the security plugin owns the policy and the helper stays unit-testable. Verified end-to-end with `pnpm dev:crm`: 2nd registered user gets 3 leads, 5 accounts, 4 opportunities, 5 campaigns, 4 products, 5 tasks, 2 cases, 1 contract cloned into their personal workspace.
- **Contact integrity hook uses `where:` not `filter:`** (`examples/app-crm`) — The `contact_integrity` hook in the CRM example was passing `{filter: {...}}` to `api.object('contact').findOne()` / `count()` / `updateMany()`. ObjectQL's hook API expects `{where: {...}}`; the unknown `filter` key was silently ignored, causing `findOne` to return the first row in the table regardless of email/account, which made every cross-tenant contact insert fail with a spurious "duplicate email" error. All five call sites updated.

### Added
 - **Auto-create personal organization for newly-registered users** (`@objectstack/plugin-security`) — In multi-tenant mode (`OS_MULTI_TENANT !== 'false'`), when a `sys_user` row is inserted with no existing `sys_member` link, SecurityPlugin now creates a personal `Workspace` org and an `owner`-role membership for the user as part of the same post-create hook that runs the bootstrap-replay. Closes a UX trap where a brand-new user landed on `/_dashboard/` with `activeOrganizationId: null` and zero memberships — the published `@object-ui/app-shell` `RequireOrganization` guard let them through (single-tenant carve-out: `orgList.length === 0`), but the default `tenant_isolation` RLS then hid every record (correctly), so the user saw an empty dashboard with no path forward and no way to create their first org. Helper `ensureUserHasOrganization()` is idempotent (skipped when the user already has any membership), derives a slug from the user's `name → email-local-part → id` with `-2`…`-5` collision retry, and fails loud after 5 attempts so an admin can intervene rather than silently creating malformed slugs. 9 unit tests in `ensure-user-has-organization.test.ts`.

- **Auto-claim orphan seed rows for the first organization** (`@objectstack/plugin-security`) — When the very first `sys_organization` is inserted in multi-tenant mode, SecurityPlugin now back-fills `organization_id` on every user-defined object's seed rows that landed with `organization_id IS NULL`. Seeds (`defineDataset`) run as `isSystem: true` to bypass auto-injection (correct for cross-tenant defaults such as `sys_permission_set`), but that left CRM-style business seeds (`lead`, `account`, `contact`, …) invisible to the freshly-registered owner because the default `tenant_isolation` RLS policy (`organization_id = current_user.organization_id`) filtered them out. The new claim hook (`claimOrphanTenantRows`) walks `ql.registry.getAllObjects()`, skips schemas with `managedBy` set and any `sys_*` prefix (so cross-tenant defaults stay cross-tenant), finds rows with `organization_id IS NULL`, and updates them as `isSystem`. Idempotent — gated on the post-insert org count being exactly 1, so it only fires once per platform; subsequent organizations don't re-claim. User hooks that reject the update (e.g. a frozen record) are logged at `warn` and skipped without aborting the rest of the claim. Verified end-to-end with `pnpm dev:crm` + Chrome MCP: fresh DB → sign up → create org → 30 CRM seed records (3 leads, 5 accounts, 4 opportunities, 4 products, 5 campaigns, 5 tasks, 2 cases, 1 contact, 1 contract) all visible on `/_dashboard/apps/crm_enterprise/lead`. 8 new unit tests in `claim-orphan-tenant-rows.test.ts`.

### Fixed
- **Cross-tenant RLS leak when `roles` resolves to zero permission sets** (`@objectstack/plugin-security`) — `SecurityPlugin`'s middleware combined the user's `roles` (from `ExecutionContext.roles`, populated by `resolve-execution-context.ts` from `sys_member.role`) with explicit `permissions` and called `PermissionEvaluator.resolvePermissionSets(requested, …)`. The pre-resolution fallback only fires when `requested.length === 0`, so authenticated org members whose better-auth role (`owner` / `admin` / `member`) has no `sys_role` → `sys_permission_set` binding produced `requested = ['owner']`, which then resolved to `[]` because no metadata mapped that name to a permission set. Both the CRUD check (`if (permissionSets.length > 0)`) and the RLS injection (`if (allRlsPolicies.length > 0)`) below were skipped → fail-OPEN: an org owner could read every other tenant's records via `GET /api/v1/data/lead`. Added a **post-resolution fallback**: when `permissionSets.length === 0` after `resolvePermissionSets()` AND `userId` is set AND `fallbackPermissionSet` is configured, re-resolve with the fallback (default `member_default`), so the standard `tenant_isolation` (`organization_id = current_user.organization_id`) and `owner_only_writes` policies still apply. Verified end-to-end with `pnpm dev:crm` + curl: admin sees their 3 seeded leads, `zhuangjianguo` (a separate org owner) sees `total: 0` instead of admin's 3 leads. New unit test in `security-plugin.test.ts` covers the post-resolution path explicitly.

- **Auto-injected `organization_id` system field on every user object** (`@objectstack/objectql`, `@objectstack/spec`, `@objectstack/plugin-security`) — `SchemaRegistry.registerObject()` now runs `applySystemFields(schema, { multiTenant })` before storing the contributor, splicing in an `organization_id` field (`lookup → sys_organization`, `hidden`/`readonly`/`indexed`) on every registered object that (a) doesn't already declare one and (b) isn't `managedBy: 'better-auth' | 'system' | 'platform'` and (c) hasn't opted out via the new `systemFields: false | { tenant?: false; owner?: false; audit?: false }` field on `ObjectSchema`. The registry honours `OS_MULTI_TENANT` (default `true`) the same way `SecurityPlugin` and the CLI startup banner do, so single-tenant deployments incur zero registration-time cost. Author-declared `organization_id` always wins (no overwrite). Combined with the existing SecurityPlugin auto-fill on insert and the `tenant_isolation` RLS policy, this means: out of the box, every CRM/business object built on ObjectStack is multi-tenant — schema authors no longer have to remember to declare `organization_id` per-object, and the long-standing footgun of "I just inserted a row but it's not visible because organization_id is NULL" is gone. Verified end-to-end with `pnpm dev:crm`: fresh DB → sign up → create org → `POST /api/v1/data/lead` → `organization_id` populated from `session.activeOrganizationId`; switch to a 2nd org → leads created there carry the 2nd org's id. Tests: 7 new cases in `registry.test.ts` covering injection, opt-out (`systemFields: false`), per-key opt-out (`systemFields: { tenant: false }`), `multiTenant: false`, manageBy skip, author-declared override.

### Fixed
- **`SecurityPlugin` saw the un-augmented schema during auto-fill** (`@objectstack/plugin-security`) — `loadObjectFieldNames()` previously consulted the kernel's `metadata` service first and only fell back to `ObjectQL.getSchema()` when metadata had no entry. With the new registry-time `organization_id` injection (above), this ordering caused metadata to serve the original (pre-registration) schema while the registry held the augmented one — so SecurityPlugin's auto-fill on insert thought the column didn't exist and skipped populating `organization_id`. Reversed the order: `ObjectQL.getSchema()` is now the primary source of truth (it always reflects registry-time augmentation), with the metadata service as fallback for objects ObjectQL doesn't know about.

### Fixed
- **Engine: unknown `select` fields silently returned empty rows** (`@objectstack/objectql`) — When a query requested fields that don't exist on the target object's schema (e.g. dashboard's auto-generated card view requesting `name`/`due_date`/`image`/`start_date`/`end_date` against every object regardless of its real shape), `Engine.find` and `Engine.findOne` passed those names straight through to the driver. `SqlDriver` then emitted `SELECT unknown_col FROM lead`, the DB rejected it with "no such column", and `SqlDriver` *swallowed* the error returning `[]` (sql-driver.ts:206-212) — so the API responded `200 { records: [], total: 0 }`. Result: every row of the `lead` object disappeared from `/_dashboard/apps/crm_enterprise/lead` even though the records existed and the user could read them via `?limit=20`. Now both `find()` and `findOne()` filter `ast.fields` against `schema.fields` (keeping relationship paths like `owner.name` by validating only the head segment) before the driver is invoked. If filtering produces an empty list, fall back to `undefined` so the driver projects `*` instead of an empty SELECT. Verified end-to-end via Chrome devtools: dashboard's lead grid now shows all 4 records (3 seeded + 1 user-created) instead of "No Leads Yet".

- **Vercel/serverless: projects stuck in `provisioning` with `database_url=null`** (`@objectstack/runtime`, `@objectstack/service-cloud`, `@objectstack/rest`) — `POST /cloud/projects` ran the actual DB-creation work via `void runProvisioning()` and immediately returned `202`. On Vercel (and other serverless platforms — AWS Lambda, Netlify, Cloudflare Pages) the function instance is frozen the moment the response is sent, so the background task never runs and `database_url` is never persisted. Every subsequent request for that project crashed with `[ProjectKernelFactory] Project … missing database_url/database_driver` reported as an "Unhandled error" 500. Fix:
  1. **Auto-await on serverless** (`http-dispatcher.ts:create-project`) — detect `process.env.VERCEL` / `AWS_LAMBDA_FUNCTION_NAME` / `NETLIFY` / `CF_PAGES` and `await runProvisioning()` inline (returning `201` instead of `202`). Operators can override either way with `OS_PROVISION_SYNC=1` or `OS_PROVISION_SYNC=0`.
  2. **Better factory error** (`runtime/project-kernel-factory.ts` and `service-cloud/project-kernel-factory.ts`) — include the actual `sys_project.status` and an actionable hint (`set OS_PROVISION_SYNC=1 on serverless` for `provisioning`/`pending`; `inspect sys_project.metadata.provisioningError` for `failed`).
  3. **Proper HTTP semantics** (`@objectstack/rest`) — `mapDataError` now recognises the factory's "missing database_url" message and maps it to `503 PROJECT_PROVISIONING` (still in flight), `502 PROJECT_PROVISIONING_FAILED`, or `404 PROJECT_NOT_FOUND` instead of a generic 400/500. A new `isExpectedDataStatus` helper consolidates the "don't log as Unhandled" predicate (403/404/502/503) across all five data CRUD handlers.

### Added
- **Startup banner shows database driver + tenancy mode** (`@objectstack/cli`) — When the dev/prod server prints its "Server is ready" summary, the banner now includes a `Driver:` line (e.g. `SqlDriver(better-sqlite3) → /…/standalone.db`, `SqlDriver(pg) → host:5432/db`) and a `Tenancy:` line (`multi-tenant` / `single-tenant`) reflecting the resolved `OS_MULTI_TENANT` value. Previously the driver line only rendered when `serve.ts`'s own `OS_DATABASE_URL` fallback registered the driver — in single-project mode (`pnpm dev:crm`, app preset, `ProjectKernelFactory`) the driver was wired earlier in the lifecycle so the banner stayed silent about which DB was actually in use. A new `describeRegisteredDriver(kernel)` probe in `serve.ts` looks up well-known service names (`driver.com.objectstack.driver.{sql,mongodb,turso,memory}` plus their short aliases), introspects the driver instance (`config.client`, `config.connection.filename`/`host`/`port`/`database`, or `driver.url` for non-SQL drivers), and falls back gracefully to `(in-memory)` / `(unknown)` when no metadata is exposed. The whole probe is wrapped in try/catch so a misbehaving driver never breaks the boot summary.

- **`multiTenant` switch on `SecurityPlugin`** (`@objectstack/plugin-security`) — `new SecurityPlugin({ multiTenant: false })` disables the two pieces of the security pipeline that exist solely to support multi-organization deployments: the `organization_id` auto-injection on insert and the wildcard `tenant_isolation` RLS policy (`organization_id = current_user.organization_id`) shipped with the default `member_default` / `viewer_readonly` permission sets. In single-tenant mode every insert skips a metadata lookup, every find skips the field-existence safety net + RLS compile/AND-merge for the wildcard tenant policy, and the per-object schema lookup is now cached (positive results only — a `null` may simply mean the schema isn't registered yet at boot, so we let the next call retry). Owner-based RLS, per-object CRUD checks, and Field-Level Security are unaffected. Both the CLI dev server (`packages/cli/src/commands/serve.ts`) and the dev plugin (`packages/plugins/plugin-dev`) read `OS_MULTI_TENANT` (default `true`); set `OS_MULTI_TENANT=false` to switch a deployment to single-tenant. Four new tests in `security-plugin.test.ts` exercise both modes.

- **Auto-injection of tenancy fields on insert** (`@objectstack/plugin-security`) — When an authenticated, non-system user inserts a record, SecurityPlugin now auto-populates `organization_id` (from `ctx.tenantId`) and `owner_id` (from `ctx.userId`) **only when the field exists on the target object** (looked up via `getObjectFieldNames(metadata, object, ql)`) **and the payload has not already specified it**. This closes the gap that previously caused logged-in users to create rows with `organization_id = NULL`, which the default `tenant_isolation` RLS policy (`organization_id = current_user.organization_id`) would then hide on subsequent reads. System contexts (`ctx.isSystem === true`) are skipped — seeds and platform-admin operations remain explicit. Caller-wins semantics: explicit `organization_id` / `owner_id` in the payload are never overwritten, so cross-org admin grants and cross-tenant link tables (e.g. `sys_user_permission_set` with `organization_id = NULL`) still work.
- **Seed loader runs as system context** (`@objectstack/runtime`) — `SeedLoaderService.writeRecord` and the `app-plugin.ts` basic-insert fallback now pass `{ context: { isSystem: true } }` on every `engine.insert` / `engine.update` / `engine.find` call. This (a) bypasses RBAC checks so seeds can target system tables (`sys_*`) without granting wildcard permissions to a notional seed user, and (b) **disables auto-injection of tenancy fields**, ensuring seed records land exactly as authored — either with an explicit `organization_id` (org-scoped seeds) or with `organization_id = NULL` (intentionally cross-tenant / global metadata such as default permission sets). Combined with the auto-inject change above, this is the missing other half of "新增记录的时候也没有自动加上": user inserts get auto-tagged, seed inserts don't.

- **Zero-config first-user platform admin bootstrap** (`@objectstack/plugin-security`) — On every server boot and after every `sys_user` insert, `bootstrapPlatformAdmin()` runs idempotently to (a) seed the three default permission sets (`admin_full_access` / `member_default` / `viewer_readonly`) into the `sys_permission_set` table and (b) — if no platform admin exists yet — promote the oldest registered user by inserting a `sys_user_permission_set` link with `organization_id = NULL` (= cross-tenant) targeting `admin_full_access`. The post-create middleware listens to both `create` and `insert` operations because better-auth's adapter calls `dataEngine.insert('sys_user', …)` directly. Result: `pnpm dev:crm` → sign up → first user is platform admin, no env vars or CLI flags required.

### Fixed
- **REST single-kernel mode silently dropped RBAC permissions** (`@objectstack/rest`) — `RestServer.resolveExecCtx` previously fetched `objectql` only from a per-project kernel obtained via `kernelManager`. In single-project deployments (`pnpm dev:crm`, the default zero-config local mode) `kernelManager` is undefined, so `kernel` was `undefined` and the `sys_member` / `sys_user_permission_set` / `sys_permission_set` link-table lookups were silently skipped — every authenticated user landed on the `member_default` fallback regardless of explicit grants, *including the platform-admin promotion*. Added an `objectQLProvider` constructor argument to `RestServer` and wired it from `RestApiPlugin.start()` so single-kernel deployments resolve roles + permission sets correctly. Verified end-to-end: `first@test.com` (auto-promoted platform admin) sees all `sys_user` rows; `second@test.com` (regular) sees only their own row, and writes to managed identity tables remain 403.
- **Hardcoded `permissions: ['member_default']` removed** from two raw-fallback HTTP entry points (`@objectstack/plugin-hono` `/data/:object` handlers and `@objectstack/rest` multi-kernel path). Both now mirror the canonical link-table lookup in `runtime/src/security/resolve-execution-context.ts`, including matching cross-tenant rows (`organization_id IS NULL`) so platform-admin grants apply regardless of the active organization.

### Fixed
- **Cold-start `ENOENT: mkdir '/var/task/.objectstack'` on Vercel/Lambda** (`@objectstack/service-cloud`) — `createCloudStack()`, `createRuntimeStack()`, `DefaultProjectKernelFactory`, `DefaultEnvironmentDriverRegistry`, and `ArtifactEnvironmentDriverRegistry` previously hard-coded the SQLite/InMemoryDriver default data directory to `<process.cwd()>/.objectstack/data`. On serverless platforms (Vercel `/var/task`, AWS Lambda, Netlify) the bundle root is read-only, so `apps/cloud` failed to boot whenever no explicit persistent DB URL was configured. Centralised the resolution in a new `resolveDefaultDataDir()` helper (`packages/services/service-cloud/src/data-dir.ts`) that honours `OS_DATA_DIR`, returns `<cwd>/.objectstack/data` on writable filesystems, and **throws a fail-fast error on serverless** pointing at `TURSO_DATABASE_URL` (recommended on Vercel — Turso is the default ObjectStack pairing for serverless), `OS_CONTROL_DATABASE_URL`, and `OS_DATA_DIR` (escape hatch for EFS / mounted volumes). File-backed SQLite on serverless `/tmp` is rejected by design because `/tmp` is per-instance and ephemeral, which silently corrupts data across concurrent invocations. The `cloud-stack` control-driver default is now lazy so deployments that set `TURSO_DATABASE_URL` never hit the throw. 15 unit tests cover the precedence, error message contents, and platform detection in `test/data-dir.test.ts`.
- **`@objectstack/studio` Vercel build: `webcrypto` not exported by `mocks/node-polyfills.ts`** — `@objectstack/runtime` imports `webcrypto` from `crypto`, but the studio Vite alias swaps `crypto` for the local node polyfill which did not export it. Added a `webcrypto` shim that proxies to `globalThis.crypto`, restoring the rolldown build.
- **`@objectstack/driver-sql` tests failing in CI** — Added `vitest.config.ts` with resolve aliases for `@objectstack/spec/*` subpath exports (`/data`, `/contracts`, `/system`). Without these aliases, vitest could not resolve the source paths at test time, causing all 81 tests to fail with `ERR_MODULE_NOT_FOUND`.
- **RLS fail-open across tenants** (`@objectstack/plugin-security`) — A logged-in user with no active organization (e.g. immediately after sign-up, before joining or creating one) was previously seeing every tenant's data on `account`, `sys_member`, `sys_organization`, etc. Multiple compounding bugs were responsible:
  1. `RLSCompiler.compileFilter` returned `null` when policies were applicable but none compiled — interpreted by callers as "no RLS configured" → no filter → all rows. **Fix:** introduced exported `RLS_DENY_FILTER` sentinel (`{ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' }`); `compileFilter` now returns it when `policies.length > 0` but every policy expression failed to compile (missing `current_user.*` variable, unsupported expression, etc.). This naturally yields zero rows on every driver without throwing.
  2. `SecurityPlugin.extractTargetField` used the regex `/^\s*([a-z_][a-z0-9_]*)\s*(=|IN|in)\b/` — the `\b` after `=` could never match (both `=` and the following whitespace are non-word characters, so no word boundary exists). The function silently returned `null` for *every* `field = current_user.x` policy, defeating the field-existence safety net entirely. **Fix:** replaced the trailing `\b` with a `(?=\s|\()` lookahead.
  3. `SecurityPlugin.getObjectFieldNames` only handled `Array<{ name }>`-shaped fields and only consulted the kernel's `metadata` service — but object schemas in this runtime are dict-shaped (`fields: { name: Field.text(...), … }`) and live on the ObjectQL registry, not the metadata-manager. The lookup always returned `null`, which short-circuited to "keep all policies" → tables that lacked `organization_id` (e.g. CRM `account`, `sys_organization`) had a bogus `organization_id = …` filter applied, which different drivers interpreted differently (some erroring, some silently returning 0/all). **Fix:** the helper now handles both array and dict shapes and falls back to `objectql.getSchema(name)` when the metadata service has no entry.
  4. The field-existence filter previously *dropped* policies whose target column didn't exist on the object, leaving the policy set empty for tables like `account` (no `organization_id`) — fail-OPEN. **Fix:** policies dropped for missing fields now contribute the deny sentinel, so tables that haven't adopted multi-tenancy are denied by default; per-object overrides such as `sys_user_self` (`id = current_user.id`) still grant access via OR-combine.
  Three regression tests added in `packages/plugins/plugin-security/src/security-plugin.test.ts` (unsupported expression → deny, missing user-context variable → deny, valid tenant policy still compiles normally). End-to-end verified on `pnpm dev:crm`: a user without an active org gets `total: 0` on `sys_member`/`sys_organization`/`account`; a user with an active org sees only their org's rows.
- **`PermissionDeniedError` returned as HTTP 404 instead of 403** (`@objectstack/rest`) — `mapDataError` previously fell through to the unknown-object heuristic for any error message containing the object name and the substring `"not"`, which matched the security message `"… on object 'sys_user' is not permitted …"`. The mapper now short-circuits on `error.code === 'PERMISSION_DENIED'` / `error.name === 'PermissionDeniedError'` / message-prefix match before the heuristic and returns HTTP 403 with `code: 'PERMISSION_DENIED'`. The CRUD route catches in `RestServer` also stop logging 403s as `[REST] Unhandled error:` (4 sites updated).

### Added
- **`managedBy` flag on `ObjectSchema`** (`@objectstack/spec`) — `Object.managedBy?: 'better-auth' | 'system' | 'platform'` is a Zod-first marker that downstream UI (Studio / Dashboard / app shell) and CLI tooling should honour to suppress the generic CRUD form for tables whose lifecycle is owned by an external service. Documented in `packages/spec/src/data/object.zod.ts` with the rationale that better-auth-managed identity tables (`sys_user`, `sys_session`, `sys_organization`, …) require side-effects (password hashing, email-verification flows, invitation tokens, refresh-token rotation, JWKS rotation) that the generic record editor cannot reproduce, so writes must go through better-auth's typed SDK methods instead.
- **17 better-auth identity objects annotated with `managedBy: 'better-auth'`** (`@objectstack/platform-objects`) — `sys_user`, `sys_account`, `sys_session`, `sys_organization`, `sys_member`, `sys_invitation`, `sys_team`, `sys_team_member`, `sys_api_key`, `sys_two_factor`, `sys_verification`, `sys_jwks`, `sys_device_code`, `sys_oauth_application`, `sys_oauth_access_token`, `sys_oauth_refresh_token`, `sys_oauth_consent`. (`sys_user_preference` is excluded — it is user-managed.)
- **Server-side write deny for managed identity tables** (`@objectstack/platform-objects`) — `default-permission-sets.ts` now exports `BETTER_AUTH_MANAGED_OBJECTS` + `denyWritesOnManagedObjects()` and spreads it into both `member_default.objects` and `viewer_readonly.objects`, producing per-table `{ allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false }` overrides on top of the wildcard. The admin profile (`admin_full_access`) keeps a `'*': { allowCreate: true, modifyAllRecords: true, … }` wildcard so platform admins are unaffected. End-to-end probe verified: an authenticated non-admin user receives HTTP 403 + `code: 'PERMISSION_DENIED'` on `POST /api/v1/data/sys_user`, `POST /api/v1/data/sys_member`, `POST /api/v1/data/sys_organization`, `PATCH /api/v1/data/sys_user/<self>`, and `DELETE /api/v1/data/sys_user/<self>`. Reads remain allowed and are still scoped by RLS (`sys_user_self`, `sys_organization_self`).

### Added
- **Account portal: full better-auth SDK migration** — All user-settings pages (`/account/*`) and the first-run `/setup` wizard now use typed SDK methods from `@objectstack/client` instead of raw `fetch()` calls against `/api/v1/auth/…`. This fixes several silent bugs (wrong parameter names, invented endpoints) and adds missing features:
  - **SDK extensions** (`packages/client`): `auth.{updateUser, changePassword, changeEmail, sendVerificationEmail, verifyEmail, deleteUser, bootstrapStatus}`, `auth.sessions.{list, revoke, revokeOthers, revokeAll}`, `auth.twoFactor.{enable, verifyTotp, disable, generateBackupCodes, verifyBackupCode}`, `auth.accounts.{list, unlink, linkSocial}`, `organizations.{removeMember, updateMemberRole, getActiveMember, leave}`, `organizations.invitations.{list, listMine, cancel, accept, reject, resend}`, `organizations.teams.{list, create, update, delete, listMembers, addMember, removeMember}`.
  - **Teams plugin enabled** (`plugin-auth`): `teams: { enabled: true }` on better-auth organization plugin.
  - **New pages**: `/account/invitations` (pending invitation inbox), `/account/linked-accounts` (OAuth provider link/unlink), `/organizations/$orgId/teams` (team CRUD + membership).
  - **Refactored pages**: `/setup` (multi-step with invite teammates), `/account/profile` (avatar upload), `/account/security` (change email + delete account), `/account/sessions` (current-session badge), `/account/two-factor` (backup codes panel), `/organizations/$orgId/members` (inline role edit, bulk invite, leave org, copy invite link, resend).
  - **Hooks rewritten**: `useOrganizationMembers` — drops direct `sys_invitation` data-API calls; adds `useOrganizationInvitations`, `useMyInvitations`.
- **Phase-1 RBAC end-to-end enforcement (multi-tenant isolation)** — Every authenticated REST request now arrives at the SecurityPlugin middleware with a populated `ExecutionContext`, so RLS/FLS/CRUD checks actually fire. Three previously-silent context-drop sites were closed: (1) `@objectstack/objectql` `protocol.{find,get,create,update,delete}Data` now forward `request.context` into the engine call options; (2) `@objectstack/rest` `RestServer` gained `resolveExecCtx()` plus an `authServiceProvider` constructor hook (wired in `RestApiPlugin` from `ctx.getService('auth')`) that resolves the better-auth session for both single-kernel and multi-kernel deployments and threads `context` into all five CRUD handlers; (3) `@objectstack/plugin-hono-server` raw `/data/:object` fallback handlers now resolve the same context inline and map `PermissionDeniedError` → HTTP 403. `@objectstack/runtime` `resolveExecutionContext()` wraps plain header objects as Web `Headers` so better-auth's cookie lookup works. New seed link tables `sys_user_permission_set` / `sys_role_permission_set` (in `@objectstack/platform-objects`) plus default permission sets `admin_full_access` / `member_default` / `viewer_readonly`; `member_default` carries a wildcard `object: '*'` RLS policy (`tenant_id = current_user.tenant_id`) that SecurityPlugin rewrites onto the configured `tenantField` (default `organization_id`) and skips for tables that lack the field. Three further fixes landed alongside the wiring work: (a) `@objectstack/objectql` lost its legacy `registerTenantMiddleware` (a hardcoded `where.tenant_id = ctx.tenantId` injection that pre-dated SecurityPlugin, masked RLS bugs in older snapshots, and silently broke any table without a `tenant_id` column); SecurityPlugin is now the sole authority for tenant isolation. (b) The previous abstract-`tenant_id` indirection in `@objectstack/plugin-security` (`SecurityPluginOptions.tenantField` + a regex that rewrote `tenant_id = current_user.tenant_id` onto the configured physical column at compile time) has been **removed**. The placeholder, the physical column, and `RLSUserContext.organization_id` now use the same canonical name end-to-end (`organization_id`), eliminating an entire class of silent-drop bugs caused by greedy rewrites and removing the most confusing piece of the security DX. Schemas with a different physical tenant column should fork the default permission sets — the runtime `ExecutionContext.tenantId` is unchanged. (c) `member_default` and `viewer_readonly` gained explicit per-object overrides for the two global tables that lack `organization_id`: `sys_organization_self` (`id = current_user.organization_id`) and `sys_user_self` (`id = current_user.id`). Verified end-to-end on `pnpm dev:crm`: two users in different organizations each create records and only see their own org's rows on subsequent LISTs across `sys_organization`, `sys_member`, `sys_user`, and the new `sys_user_permission_set` / `sys_role_permission_set` link tables. **Known follow-up:** anonymous REST traffic still bypasses enforcement (SecurityPlugin short-circuits when `userId` is absent) — default-deny tightening, Sharing Rule evaluator, Studio RLS visual editor, per-user×org permission cache, and audit UI / denied-access logging remain queued.
- **`@objectstack/driver-mongodb` — first-class MongoDB driver (`packages/plugins/driver-mongodb`)** — A new built-in driver that implements the full `IDataDriver` contract on top of the official `mongodb@^6` Node.js driver. Highlights: per-collection `id` strategy (16-char nanoid stored as a top-level string field with a unique index; the internal `_id` is **never** exposed to consumers — every `find`/`findOne`/`findStream` uses `projection: { _id: 0 }`); pluggable filter translator (`mongodb-filter.ts`) that maps every ObjectStack operator (`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte`/`$in`/`$nin`/`$exists`/`$contains`/`$startsWith`/`$endsWith`/`$null`/`$between`/`$not`/`$and`/`$or`/`$nor`) plus the legacy `[field, op, value]` tuple form into a native MongoDB query; aggregation pipeline builder (`mongodb-aggregation.ts`) supporting `count`/`sum`/`avg`/`min`/`max`/`count_distinct`/`string_agg` with `$group + $project` flattening; declarative schema sync that creates collections + unique/lookup/text/compound indexes (`mongodb-schema.ts`); cursor-based async streaming via `findStream`; `bulkCreate`/`bulkUpdate`/`bulkDelete` powered by `bulkWrite`; multi-document transactions (requires a replica set) via `MongoClient.startSession()` + `session.withTransaction()`. Ships with **75 unit tests** (filter, aggregation, full driver) running against `mongodb-memory-server` (`onlyBuiltDependencies` whitelist updated in the root `package.json` so the postinstall is allowed). Plugin entry exports a default `onEnable` hook so it can be registered as `kernel.use(mongodbPlugin, { url })` or instantiated directly via `new MongoDBDriver({ url })` and wrapped in `DriverPlugin`.
- **`OS_DATABASE_DRIVER` / `OS_DATABASE_URL` recognised by the CLI, with URL-scheme inference** — `packages/cli/src/commands/serve.ts` now selects the storage driver from `OS_DATABASE_URL` automatically: `mongodb://` / `mongodb+srv://` → `MongoDBDriver`, `postgres://` / `postgresql://` → `SqlDriver(client:'pg')`, `mysql://` / `mysql2://` → `SqlDriver(client:'mysql2')`, `libsql://` or `https://*.turso.…` → `TursoDriver`, `file:` / `sqlite:` / `:memory:` / `*.db` / `*.sqlite` → `SqlDriver(client:'better-sqlite3')`. `OS_DATABASE_DRIVER` remains an explicit override (`mongodb`/`mongo`/`postgres`/`pg`/`mysql`/`sqlite`/`turso`/`libsql`). The same selection logic is mirrored in `packages/services/service-cloud/src/{artifact-environment-registry,environment-registry,project-kernel-factory}.ts` so cloud-runtime nodes can also pin a project to MongoDB. `apps/objectos`, `packages/cli`, and `packages/services/service-cloud` now declare `@objectstack/driver-mongodb` (and the CLI now also declares `@objectstack/driver-turso`) as workspace dependencies so the dynamic `await import()` resolves.
- **MongoDB end-to-end test for the CRM example** — `examples/app-crm/playwright.config.ts` + `examples/app-crm/e2e/mongodb-driver.spec.ts` boot `pnpm dev:crm` with `OS_DATABASE_URL=mongodb://localhost:27017/objectstack_crm_test` against a local mongod (driver auto-inferred from the URL scheme — no `OS_DATABASE_DRIVER` needed) and verify (1) the Studio UI responds, (2) seed data is queryable through `GET /api/v1/data/account`, and (3) a full create → read → patch → re-read → delete round-trip lands records in MongoDB. New `pnpm --filter @example/app-crm test:e2e` script wires the suite into the workspace.

- **Hooks auto-register from `defineStack({ hooks })` (`@objectstack/objectql` + `@objectstack/runtime`)** — Hooks are metadata, and the runtime now treats them as such: `AppPlugin.start()`, `MultiProjectPlugin` seeders, and `ObjectQLPlugin.loadMetadataFromService` all funnel `Hook[]` through a single canonical entry point (`bindHooksToEngine` / `engine.bindHooks`), eliminating the previous boilerplate `engine.registerHook(...)` calls in user code. The binder honours every declarative field on `Hook` — `condition` (compiled as a formula), `async` (fire-and-forget on `after*` events), `retryPolicy` (max retries × linear backoff), `timeout` (Promise.race), `onError` (`'abort'` rethrows, `'log'` swallows), and `priority` — through a new `wrapDeclarativeHook` higher-order function so the engine's `triggerHooks` stays minimal. Adds `engine.registerFunction` / `resolveFunction` / `unregisterFunctionsByPackage` plus `engine.unregisterHooksByPackage(packageId)` for clean hot-reload, and a new `functions` field on `defineStack` so string-named handlers can be resolved by the binder. The built-in audit hooks in `ObjectQLPlugin.registerAuditHooks` were migrated to the same declarative form (dogfood). Example cleanup: `examples/app-crm/src/hooks/register-hooks.ts` deleted; the CRM example now just exports `allHooks` and lists them under `defineStack({ hooks })`.
- **Formula expression evaluator (`@objectstack/objectql`)** — `packages/objectql/src/formula.ts` ships a hand-written tokenizer + recursive-descent parser + tree-walking evaluator for the formula function library documented in `packages/spec/docs/formula-functions.md`. Supports text (`CONCAT`/`CONCATENATE`/`UPPER`/`LOWER`/`TEXT`/`LEN`), math (`SUM`/`AVERAGE`/`ROUND`/`CEILING`/`FLOOR`), date (`TODAY`/`NOW`/`YEAR`/`MONTH`/`DAY`/`ADDDAYS`), and logical (`IF`/`AND`/`OR`/`NOT`/`ISBLANK`) functions, plus comparison (`= == != <> < > <= >=`) and arithmetic operators with standard precedence. Public API: `compileFormula(expr)` (cached AST + dependency list) and `evaluateFormula(expr, record)`. Implementation is `eval`-free — untrusted formula strings are safe to evaluate. Used by `formula`-typed fields and decision-node conditions in flows.
- **Studio Flow Viewer + Flow Test Runner** — `apps/studio/src/components/FlowViewer.tsx` renders a flow's metadata (variables, nodes, edges, error handling) as inspector cards; `FlowTestRunner.tsx` provides an interactive form for the flow's `isInput` variables, executes the flow against the per-project kernel, and surfaces the result + run record. Wired into the Studio metadata browser via `flow-viewer-plugin.tsx` (registered in `apps/studio/src/plugins/built-in/index.ts`), so any `flow` metadata page exposes a "Run" tab. New `FlowRunsPanel.tsx` lists historical executions for the selected flow.
- **Automation: flow discovery from ObjectQL registry** — `AutomationServicePlugin.start()` (`@objectstack/service-automation`) now pulls every inline flow definition out of the ObjectQL schema registry (`ql.registry.listItems('flow')`) and registers them with the engine after the `automation:ready` hook fires. Flows declared via `defineStack({ flows: [...] })` or attached to an object via `manifest.register()` are picked up automatically — no per-flow `engine.registerFlow()` boilerplate. The plugin keeps a soft dependency on `metadata` (looked up at start, tolerated if absent).
- **Single-project mode (`os run` / `apps/objectos`)** — `@objectstack/service-cloud` ships `createSingleProjectPlugin({ orgId?, projectId?, orgName?, projectDatabaseUrl, projectDatabaseDriver? })` which (1) idempotently seeds a real `sys_organization` + `sys_project` row in the control-plane DB on every boot via `ensureLocalIdentity()`, and (2) overrides `GET /api/v1/studio/runtime-config` with `{ singleProject: true, defaultOrgId, defaultProjectId }`. Defaults: `org_local` / `proj_local`. The Studio top-bar conditionally hides the project switcher and slash divider when single-project mode is active; navigation routes inside Studio use the constant `PLATFORM_PROJECT_ID` instead of a per-request param. `apps/objectos` ships project templates (`blank`, `crm`, `todo`, `extract`) under `apps/objectos/server/templates/` selectable at provisioning time.
- **Static Setup App (`@objectstack/platform-objects`)** — The Setup App (`/_studio/apps/setup`) is now a fixed metadata artifact exported from `packages/platform-objects/src/apps/setup.app.ts` instead of being assembled by a `SetupPlugin` at runtime. Navigation groups: **Overview** (System / Security dashboards), **Administration** (Users, Organizations, Teams, API Keys, Roles, Permission Sets, **OAuth Apps**, **Signing Keys**), **Platform** (Objects, Views, Flows, AI Agents/Tools, Apps, Packages, Installations, All Metadata), **System** (**Sessions**, Audit Logs, **Activity**, **Comments**). The runtime registration now happens inside `@objectstack/plugin-auth` via `manifest.register({...})`. Two new platform objects ship alongside: `sys_activity` (audit-style activity log) and `sys_comment` (user-authored comments on records).
- **`os` CLI: built-in `auth` / `audit` / `security` plugin tier** — `os serve` (and `os dev`) auto-registers `@objectstack/plugin-auth`, `@objectstack/plugin-security`, and `@objectstack/plugin-audit` whenever the `auth` tier is enabled and the project hasn't pinned them in `objectstack.config.ts`. Tier presets: `minimal: ['core']`, `default: ['core', 'i18n', 'ui', 'auth']`, `full: [..., 'ai']`. Override via `--preset minimal|default|full` or by setting `tiers` on the stack config.
- **`os` CLI: `--port / -p` flag for `dev` / `serve` / `studio`** — Default `process.env.PORT ?? 3000`. The dev-runner forwards `--port` to the spawned `serve` process so HMR + SSR share one port.

### Changed
- **BREAKING: Environment variable prefix `OBJECTSTACK_*` → `OS_*`** — Every public env var has been renamed: `OBJECTSTACK_MODE` → `OS_MODE`, `OBJECTSTACK_MULTI_PROJECT` → `OS_MULTI_PROJECT`, `OBJECTSTACK_PROJECT_ID` → `OS_PROJECT_ID`, `OBJECTSTACK_DATABASE_URL` → `OS_DATABASE_URL`, `OBJECTSTACK_DATABASE_DRIVER` → `OS_DATABASE_DRIVER`, `OBJECTSTACK_ARTIFACT_PATH` → `OS_ARTIFACT_PATH`, `OBJECTSTACK_PROJECT_ARTIFACTS` → `OS_PROJECT_ARTIFACTS`, `OBJECTSTACK_PROJECT_ARTIFACT_ROOT` → `OS_PROJECT_ARTIFACT_ROOT`, `OBJECTSTACK_CLOUD_URL` → `OS_CLOUD_URL`, `OBJECTSTACK_CLOUD_API_KEY` → `OS_CLOUD_API_KEY`. The legacy `OBJECTSTACK_*` names continue to be read as deprecated aliases (one-shot warning at boot) and will be removed in the next major release. All Dockerfiles, fly.toml, vercel.json, `.env.example` files, README files, ADRs, and the `cloud-deployment` / `project-scoping` / `examples` docs have been updated.
- **`environmentId` → `projectId` everywhere** — Metadata persistence and ObjectQL plumbing migrated off the legacy `environmentId` column. `sys_metadata` / `sys_metadata_history` are now keyed by `(organization_id, project_id, type, name)`. A schema migration (`packages/metadata/src/migrations/migrate-env-id-to-project-id.ts`) backfills existing installations on first boot. The `MetadataManager` / `DatabaseLoader` / `MetadataProjector` APIs all accept `projectId`; `environmentId` is silently aliased for one release. Resolves ROADMAP D3.
- **Setup app: dashboards default to 12-column grid** — `system_overview` and `security_overview` (`packages/platform-objects/src/apps/dashboards/`) now set `columns: 12` so the Setup app dashboards line up with the rest of the platform's responsive grid.
- **Studio top-bar: package filter is clearable** — `apps/studio/src/components/top-bar.tsx` adds an `×` affordance to the package switcher and emits an "All packages" reset event consumed by the metadata sidebar.
- **Flow approval steps use connector configuration** — `examples/app-crm/src/flows/opportunity-approval.flow.ts` updated to drive approval routing from a typed `connector` block instead of inline strings, matching the new approval node contract.

### Added
- **M3 Cloud Artifact API + runtime end-to-end** — `@objectstack/service-cloud` now ships `createCloudArtifactApiPlugin`, which registers the two M3 endpoints on the cloud control plane: `GET /api/v1/cloud/resolve-hostname?host=<hostname>` (returns `{projectId, organizationId, runtime}` with `*`-hostname wildcard fallback) and `GET /api/v1/cloud/projects/:id/artifact` (returns a v0 `ProjectArtifact` envelope assembled from `sys_project.metadata.artifact_path` files). The artifact assembler accepts both the v0 nested shape (`{metadata: {objects: [...]}}`) and the current `objectstack compile` flat shape (top-level `objects`, `apps`, `dashboards`, …). Optional bearer auth via the `OBJECTSTACK_CLOUD_API_KEY` env var on the cloud side. Wired into `cloud-stack` so any `apps/cloud` deployment now serves runtime nodes out of the box.
- **REST hostname-based project resolution for runtime mode** — `RestServer` now accepts an optional `envRegistry` and, on unscoped routes (`/api/v1/data/...`, `/api/v1/meta`, …), resolves the request `Host` header to a project via `envRegistry.resolveByHostname()` before fetching the per-project kernel's `protocol`. Combined with `KernelManager` this lets a runtime node serve every CRUD/metadata route from per-project artifacts pulled from the cloud, without callers ever including a `:projectId` in the URL. Wired automatically in `rest-api-plugin` when both `env-registry` and `kernel-manager` services are registered (i.e. runtime / multi-project modes).
- **`apps/cloud`: explicit `mode: 'cloud'`** — After the `runtime`/`standalone` rename made `standalone` the default `OBJECTSTACK_MODE`, `apps/cloud/objectstack.config.ts` now sets `mode: 'cloud'` explicitly so the control plane keeps loading the full multi-project plugin set (auth, security, audit, multi-project, cloud-artifact-api, …) regardless of the host environment.
- **`OBJECTSTACK_MODE=runtime` (renamed from `project`)** — The cloud-connected runtime node mode is now called **`runtime`**, better describing its role as a kernel runtime that pulls metadata from a control plane (instead of hosting its own). The previous mode name `project` is preserved as a deprecated alias (warns at boot). The `BootStackConfig.runtime` config field replaces `BootStackConfig.project`; the old field name is still accepted with a deprecation. **The default `OBJECTSTACK_MODE` also changes from `project` to `standalone`** — the safer, zero-config baseline (runtime-only ObjectQL + REST + Driver). Hosts that want the runtime node behavior must now opt in explicitly with `OBJECTSTACK_MODE=runtime`.
- **`OBJECTSTACK_CLOUD_URL` defaults to local `apps/cloud` (`http://localhost:4000`)** — The runtime mode's default control-plane URL is now the local `apps/cloud` instance, not the hosted `https://cloud.objectstack.ai`. `apps/cloud`'s `dev` / `start` scripts now bind to port 4000 by default (override via `PORT`). Dev workflow: start `apps/cloud` first, then start `apps/server` in runtime mode against it. For the hosted control plane, set `OBJECTSTACK_CLOUD_URL=https://cloud.objectstack.ai`. To disable cloud routing entirely and boot from a local `control.db`, set `OBJECTSTACK_CLOUD_URL=local`.
- **ObjectOS Cloud Runtime building blocks (`@objectstack/service-cloud`)** — `ArtifactApiClient` (TTL-cached HTTP client for `GET /api/v1/cloud/resolve-hostname` and `GET /api/v1/cloud/projects/:id/artifact`), `ArtifactEnvironmentRegistry` (replaces `DefaultEnvironmentDriverRegistry` — resolves hostnames over HTTP, falls back to the artifact's default datasource when no runtime block is supplied), and `ArtifactKernelFactory` (boots a kernel directly from `artifact.metadata` with `DriverPlugin + ObjectQLPlugin + MetadataPlugin + AppPlugin`, no `ControlPlaneProxyDriver`). Auth via `OBJECTSTACK_CLOUD_API_KEY` / `runtime.cloudApiKey`. Closes the "Artifact API loader + local cache durability" item under §7 Missing in the North Star.

### Changed
- **`OBJECTSTACK_MODE` redefined into three values** — Boot-mode selection now accepts `project` (default), `cloud`, and `standalone`. The previous semantics — where `standalone` meant "single-project local dev with full Auth + Studio" — moved under `project`. The new `standalone` value is **runtime-only**: ObjectQL + REST + Driver, no Auth, no control plane, no Studio data. Designed for embedding ObjectStack in other frameworks. Aliases `local` / `single-project` continue to map to `project`; `multi-project` continues to map to `cloud`. Default also changed: an unset `OBJECTSTACK_MODE` now resolves to `project` (was: `standalone`).
  - **Migration:** users running with `OBJECTSTACK_MODE=standalone` and expecting Auth/Studio should switch to `OBJECTSTACK_MODE=project` (or unset it).
  - **Internals:** `apps/server/objectstack.config.ts` now drives `project` mode through `createCloudStack()` with two local SQLite files (`control.db` for the control plane and `proj_local.db` for the single project's data), instead of a separate plugin stack. `apps/server/server/single-project-plugin.ts` is reduced to (a) seeding a real `sys_organization` + `sys_project` row into the control plane via `ensure-local-identity.ts` so `KernelManager` resolves `proj_local` exactly as in cloud mode, and (b) overriding `GET /api/v1/studio/runtime-config` with `{ singleProject: true, … }`. Synthetic `/cloud/projects` rows are gone — both modes now serve real DB-backed records. `apps/studio/server/index.ts` no longer wraps the kernel app in an outer Hono router for single-project mode.
- **`OBJECTSTACK_MODE` replaces `OBJECTSTACK_MULTI_PROJECT`** — Boot-mode selection is now driven by a single `OBJECTSTACK_MODE` variable accepting `standalone` (default) or `cloud`. The legacy `OBJECTSTACK_MULTI_PROJECT=true` flag remains as a deprecated alias (with a one-shot console warning at boot) and will be removed in the next major release. Root `pnpm dev` now starts in standalone mode; use `pnpm dev:cloud` for the multi-project / control-plane shape. Updated `apps/server/objectstack.config.ts`, `apps/studio/server/index.ts`, `.env.example`, the cloud-deployment guide, and the north-star env table.

### Added
- **Studio: cascade-delete projects and organizations** — The previously-disabled "Archive project" button on `/projects/$projectId` is now an enabled "Delete project" action with typed-name confirmation. New "Danger zone" section on `/orgs/$orgId` lets owners delete an organization, which cascades to every project the org owns (including each project's physical database). Server side adds `DELETE /api/v1/cloud/projects/:id[?force=1]` and `DELETE /api/v1/cloud/organizations/:id` to `HttpDispatcher`, both routed via `dispatcher-plugin`. The org-delete path uses better-auth's `auth.api.deleteOrganization` (which removes members + invitations + teams) and falls back to a direct `sys_organization` row delete when the plugin isn't loaded. Client SDK gains `client.projects.delete(id, { force })` and `client.organizations.delete(id)`. New Studio hooks `useDeleteProject` and `useDeleteOrganization` (the latter refreshes the session + org list so the active-org pointer is cleared automatically).
- **`os auth login` — browser-based device flow (Vercel CLI style)** — Running `os auth login` in an interactive TTY no longer requires typing a password into the terminal. The CLI now calls `POST /api/v1/auth/device/request` to obtain a one-time device code, prints the verification URL, auto-opens the browser, and polls `GET /api/v1/auth/device/token` every 2 s until the user approves. A new Studio page at `/_studio/auth/device?code=…` lets authenticated users (or users who sign in inline) approve the request with one click. The old `--email`/`--password` path is preserved for non-interactive / CI use; `--no-browser` skips auto-open. Server-side: two new endpoints (`/device/request`, `/device/token`) and an approval endpoint (`/device/approve`) added to `plugin-auth`; device codes expire after 5 min and are stored in-memory.
- **`os auth register` CLI command** — New `os auth register` command creates an account and stores credentials in one step, with interactive prompts (email, name, password) and `--email`/`--name`/`--password`/`--url` flags for non-interactive use.
- **`os auth login` — already-logged-in guard** — If a valid token already exists in `~/.objectstack/credentials.json`, `os auth login` now prints "Already logged in as \<email\>" and exits 0. Use `os auth logout` first to switch accounts, or pass `--force` to bypass the check.
- **`os auth logout` — server-side session revocation** — `os auth logout` now calls `POST /api/v1/auth/sign-out` before deleting the local credentials file, so the session is invalidated server-side. The logout completes successfully even if the API call fails (expired/invalid token).
- **Studio device auth page** — New Studio route `/_studio/auth/device` provides the browser approval UI for the CLI device flow. The page matches the login page visual style (centered card, `bg-muted`, `max-w-sm`, ObjectStack logo). Unauthenticated users see an inline sign-in form; authenticated users see a one-click "Approve CLI Access" button. The `/auth/device` route is added to `PUBLIC_ROUTES` so the auth guard does not redirect before the form renders.
- **`os auth login` / `register` / `me` now work against multi-project servers** — `@objectstack/client` was sending requests to better-auth's `/sign-in/email`, `/sign-up/email`, `/sign-out`, `/get-session` without an `Origin` header, which better-auth rejected with `MISSING_OR_NULL_ORIGIN: Missing or null Origin` against the default `trustedOrigins: ['http://localhost:*']`. Auth methods now send `Origin: <baseUrl>` automatically. Additionally, the `login()` and `register()` response normalizer now accepts both the wrapped `{ data: { token, user } }` shape and better-auth's flat `{ token, user }` shape so the CLI's `auth login` flow stores the token correctly.
- **`os projects bind` + `os projects create --artifact` CLI commands** — Third-party developers can now bind a locally-compiled bundle to a multi-project server without raw `curl`. `os projects create --org <id> --name <name> --artifact ./dist/objectstack.json` provisions a new project and seeds the bundle in one call (also supports `--template <id>` for the parity with built-in templates). The new `os projects bind <projectId> --artifact <path>` updates an existing project's `metadata.artifact_path`, with `--build` to run `objectstack compile` first and `--reseed` as a placeholder for the future server-side reseed endpoint. Both flags resolve relative paths to absolute and validate the file exists before issuing the API call. Verified end-to-end: project created via CLI, `/api/v1/projects/{id}/data/account` returns the seeded CRM accounts.
- **Third-party project binding via `metadata.artifact_path`** — Multi-project `POST /api/v1/cloud/projects` now accepts `metadata.artifact_path` to bind a locally-compiled bundle (e.g. `examples/app-crm/dist/objectstack.json`) into a fresh project. Provisioning loads the JSON, registers schemas in the per-project ObjectQL engine, and seeds the bundle's `data` arrays — same pipeline that built-in templates use. New `TemplateSeeder.seedBundle({ projectId, bundle })` method exposes the seeder for arbitrary bundles. Bind errors (read failure, malformed JSON) are recorded as non-fatal `metadata.artifactBindError` so the project still flips to `active`. Verified end-to-end: query `/api/v1/projects/{id}/data/account` returns the seeded CRM accounts.
- **`AppBundleResolver` for live kernel binding** — `apps/server` now ships `createFsAppBundleResolver()` in `apps/server/server/fs-app-bundle-resolver.ts`. Reads `sys_project.metadata.artifact_path` (or `artifact_paths[]`) at per-project kernel boot, with optional `OBJECTSTACK_PROJECT_ARTIFACTS=projId:path,…` env override and `OBJECTSTACK_PROJECT_ARTIFACT_ROOT` for relative path resolution. Used wherever a project kernel is materialized (trigger / function / metadata API requests). Replaces the previous `return []` stub.

### Fixed
- `apps/server`: `GET /api/v1/cloud/templates` now returns the full template registry (`blank`, `crm`, `todo`) on Vercel / play.objectstack.ai. Root cause: the dispatcher resolved templates through a `template-seeder` service registered by `MultiProjectPlugin`, and on Vercel cold starts that service registration could be missed by the request handler — the dispatcher then silently returned `{ templates: [], total: 0 }`. Added a `createTemplatesRoutePlugin` that registers `/cloud/templates` directly on `http.server` from a static, module-scope `listTemplates()` snapshot, registered before `DispatcherPlugin`. Local single-project mode is unchanged.
- `packages/runtime/http-dispatcher.ts`: `/cloud/templates` fallback now logs the resolution error via `console.error` instead of swallowing it silently, so the underlying cause is visible in production logs.
- `apps/server/objectstack.config.ts`: `multiProjectPluginProxy.init` now wraps the inner init in try/catch and logs failures, preventing one-off init errors from silently leaving the kernel without `template-seeder` / `kernel-manager`.
- `apps/server`: Multi-project / cloud mode now also serves `GET /api/v1/studio/runtime-config` (returns `{ singleProject: false }`) via a new `createStudioRuntimeConfigPlugin`. Eliminates the 404 the Studio SPA logged on first load when `OBJECTSTACK_MULTI_PROJECT=true` (the default for root `pnpm dev`). Single-project mode is unchanged.

### Added
- **M1 — Project Artifact envelope schema (`@objectstack/spec`)** — Introduced the v0 `ProjectArtifactSchema` in `packages/spec/src/system/project-artifact.zod.ts`, the immutable envelope that `objectstack compile` will produce and ObjectOS will consume at boot. Required fields: `schemaVersion` (literal `'0.1'`), `projectId`, `commitId`, `checksum` (`{ algorithm, value }`), `metadata` (per-category arrays, `passthrough()` for forward compatibility), `functions` (inlined source with optional language/source/hash), and `manifest` (plugin / driver / engine requirements). Optional `builtAt`, `builtWith`, and a reserved `payloadRef` (`{ url, expiresAt, checksum }`) for future S3 indirection without an envelope bump. 14 new tests in `project-artifact.test.ts`. Resolves ROADMAP M1; unblocks M3 (Artifact API) and M4 (ObjectOS artifact loader).

### Changed
- **D1 — ObjectOS metadata DB bridge removed** — `MetadataPlugin` no longer registers `sys_metadata` / `sys_metadata_history` into the ObjectOS manifest and no longer auto-bridges ObjectQL to `DatabaseLoader` during `start()`. Runtime metadata is now file/artifact backed; database-backed metadata persistence remains an explicit `MetadataManager` capability for control-plane services. Updated ROADMAP, North Star, Metadata Service docs, and ObjectStack skills to reflect the boundary.
- **D5 — `ManifestSchema.scope` enum trimmed to `'cloud' | 'system' | 'project'`** — Removed the deprecated `'platform'` and `'environment'` aliases from `packages/spec/src/kernel/manifest.zod.ts`. No call site in the workspace was setting the deprecated values, so this is a clean break. Resolves ROADMAP D5.
- **D4 — `ObjectSchemaBase.namespace` removed** — Object identity is now single-sourced on `name`. The deprecated `namespace` field has been removed from `ObjectSchemaBase` (`packages/spec/src/data/object.zod.ts`); legacy inputs that still set `namespace` are silently stripped by Zod's default object behavior. Package-level namespace (FQN computation, marketplace publishing, `DatasourceRoutingRule.namespace`) is intentionally retained as an internal mechanic. Five legacy `ObjectSchema namespace` test blocks were rewritten as a single `name-as-identity` block. Resolves ROADMAP D4.
- **D7 — Plugin manifest header + objects unified per package** — Each plugin / service now exposes a single canonical `src/manifest.ts` file that both `objectstack.config.ts` (compile-time) and the runtime `*-plugin.ts` (`manifest.register()`) import from. This eliminates a real divergence in `plugin-auth` and `plugin-security` whose configs imported from a non-existent `./src/objects/` directory and silently shipped empty object lists at compile time while their runtime registrations were intact. Affected packages: `@objectstack/plugin-auth`, `@objectstack/plugin-security`, `@objectstack/service-tenant`. Resolves ROADMAP D7.

### Fixed
- **`@objectstack/cli` — Studio static plugin no longer breaks after a Studio rebuild** — `createStudioStaticPlugin()` in `packages/cli/src/utils/studio.ts` had two latent bugs that caused the browser to fail with `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"` whenever Studio's bundle hash changed between server start and the request:
  1. `index.html` was read **once at startup** and held in memory; a Studio rebuild produced new hashed asset filenames but the cached HTML still referenced the old hashes.
  2. The SPA fallback served `index.html` for **every** unmatched path under `/_studio/`, including `/_studio/assets/*`. Combined with (1), missing hashed assets would silently respond with HTML — producing the strict-MIME error in the browser.
  Fix: read `index.html` fresh on each fallback request, and return real 404 for `/_studio/assets/*` misses so the rebuild/redeploy mismatch surfaces immediately instead of being masked. Verified end-to-end against `localhost:3000/_studio/` after a Studio rebuild.

- **`@objectstack/service-tenant` — system objects now actually register** — `createTenantPlugin()` previously declared its control-plane schemas (`sys_project`, `sys_project_credential`, `sys_project_member`, `sys_package`, `sys_package_version`, `sys_package_installation`, `sys_tenant_database`) via a top-level `objects: [...]` field on the kernel plugin object. The kernel only consumes `plugin.objects` for **nested** plugins inside a parent manifest (`packages/objectql/src/engine.ts` → `registerPlugin()`), so plugins added via `kernel.use(plugin)` had to use the `manifest` service (as `AuthPlugin`/`SecurityPlugin`/`SetupPlugin` already do). The result was that `sys__project` etc. were never registered with `SchemaRegistry`, so `ObjectQL.getDriver('sys__project')` could not match the `namespace: 'sys' → turso` `datasourceMapping` rule (the lookup returned `undefined` and skipped past the namespace check), silently routing every control-plane write to the default driver — typically the in-memory driver. On Vercel each lambda instance has its own memory, so `POST /api/v1/cloud/projects` "succeeded" with HTTP 202 but the row evaporated on cold start, causing the subsequent `GET /api/v1/cloud/projects/:id` to return 404 even though the user/organization writes (registered through the proper path by `AuthPlugin`) were correctly persisted in Turso. The plugin now registers the same set of objects via `ctx.getService('manifest').register({ id: 'com.objectstack.tenant', namespace: 'sys', objects: [...] })` and throws if the manifest service is unavailable, fail-fast instead of silent data loss. Also affected: package install/upgrade endpoints, project credential rotation, project membership reads.

### Changed
- **Platform object definitions consolidated in `@objectstack/platform-objects`** — Removed the now-redundant `@objectstack/objectos` package. Metadata-layer objects (`SysObject`, `SysView`, `SysAgent`, `SysTool`, `SysFlow`) are registered directly from `@objectstack/platform-objects/metadata`, and plugin/service packages no longer re-export platform objects through compatibility `objects` facades.
- **`examples/app-crm` — showcase `fieldGroups` MVP** — The CRM reference example (`Account`, `Contact`, `Opportunity`, `Lead`) now demonstrates the new `fieldGroups` protocol end to end. Each object declares logical groups (e.g., *Basic Information*, *Financials*, *Contact Information*, *Ownership & Status*, *System*) and every field opts in via `group: '<key>'`. No business logic changed — only field-layout metadata — so existing validations, workflows, indexes, and state machines are unaffected. Useful as a reference when designing multi-group forms and detail pages.

### Added
- **Field Groups (`fieldGroups`) — simplified MVP protocol** — Introduced a data-layer protocol for grouping fields on an object in forms, detail pages, and editors. Designed to be AI-generation- and extension-friendly by intentionally minimizing surface area:
  - New `ObjectFieldGroupSchema` in `packages/spec/src/data/object.zod.ts` with `key` (snake_case machine key), `label`, optional `icon`, `description`, `defaultExpanded` (default `true`), and `visibleOn` (expression for conditional visibility). No `order` property — **array declaration order is the display order**.
  - `ObjectSchema` gains an optional `fieldGroups: ObjectFieldGroup[]`. Group keys are validated to be unique within an object.
  - The existing `Field.group: string` property on `FieldSchema` is the sole field→group assignment mechanism. Field → group mapping is derived automatically from metadata registration; in-group display order equals the traversal order of `ObjectSchema.fields`. Extension packages and runtime code use `Field.group` uniformly.
  - Supported migrations at this layer: add / rename / delete / reorder groups (by editing the `fieldGroups` array) and assigning an existing field to a group (by editing `Field.group`). Explicit per-field in-group ordering is deferred to a future iteration.
  - New `ObjectFieldGroup` / `ObjectFieldGroupInput` type exports alongside the schema.
  - Tests: 12 new round-trip cases in `packages/spec/src/data/object.test.ts` covering minimal/full-group parsing, required fields, snake_case key validation, declaration-order preservation, duplicate-key rejection, `Field.group` referencing, and `ObjectSchema.create()` integration.
### Added
- **Environment-per-database multi-tenancy (`service-tenant` v4.1)** — Refactored the multi-tenant architecture from "per-organization database" to **per-environment database** high-isolation, with a hard split between Control Plane (environment registry / addressing / credentials / RBAC) and Data Plane (one physical database per environment). See [`docs/adr/0002-environment-database-isolation.md`](docs/adr/0002-environment-database-isolation.md) for the full rationale and trade-offs.
  - **Zod protocol schemas** (`packages/spec/src/cloud/environment.zod.ts`): `EnvironmentSchema`, `EnvironmentDatabaseSchema`, `DatabaseCredentialSchema`, `EnvironmentMemberSchema`, `EnvironmentTypeSchema`, `EnvironmentStatusSchema`, `EnvironmentRoleSchema`, `DatabaseCredentialStatusSchema`, `ProvisionEnvironmentRequest/ResponseSchema`, `ProvisionOrganizationRequest/ResponseSchema`. `TenantDatabaseSchema` is now marked `@deprecated`.
  - **Control-plane objects** (`packages/services/service-tenant/src/objects/`): `sys_environment` (UNIQUE `(organization_id, slug)`), `sys_environment_database` (UNIQUE `environment_id` — exactly one DB per environment), `sys_database_credential` (rotatable, encrypted, with `active` / `rotating` / `revoked` lifecycle), `sys_environment_member` (UNIQUE `(environment_id, user_id)`, owner / admin / maker / reader / guest). Every field carries `.describe()` metadata and every uniqueness constraint is explicit.
  - **`EnvironmentProvisioningService`** (`packages/services/service-tenant/src/environment-provisioning.ts`): `provisionOrganization()` bootstraps a new org with a default environment and DB in one call; `provisionEnvironment()` allocates any subsequent dev / test / sandbox / preview environment; `rotateCredential()` mints a new `active` credential and revokes the previous one. Pluggable `EnvironmentDatabaseAdapter` (initial `turso`; `libsql` / `sqlite` / `postgres` drop in without core changes) and `SecretEncryptor` hooks.
  - **Tenant plugin wiring**: `createTenantPlugin()` now registers the current control-plane objects directly from `@objectstack/platform-objects/tenant`.
  - **v4 → v5 migration skeleton** (`packages/services/service-tenant/migrations/v4-to-v5-env-migration.ts`): idempotent, non-destructive, re-encrypts credentials with the current KMS key, reuses existing physical DBs as each org's new `prod` environment DB — no data movement required.
  - **Tests**: 22 new schema round-trip tests in `packages/spec/src/cloud/environment.test.ts`, 10 new provisioning tests in `packages/services/service-tenant/src/environment-provisioning.test.ts` covering organization bootstrap, environment creation, default-environment invariants, adapter routing, credential rotation, and encryption hooks.

### Changed
- **Polished `examples/app-crm` dashboards** — Rewrote `executive`, `sales`, and `service` dashboards and added a new unified `crm` overview dashboard, modeled after the reference implementation at [objectstack-ai/objectui/examples/crm](https://github.com/objectstack-ai/objectui/tree/main/examples/crm/src/dashboards). The dashboards now use the framework's first-class metadata fields instead of ad-hoc hex strings stuffed into `options.color`:
  - Semantic `colorVariant` tokens (`success`/`warning`/`danger`/`blue`/`teal`/`purple`/`orange`) replace raw hex codes
  - Each widget carries a `description`, `chartConfig` (axes, color palette, annotations, interaction), and a header `actionUrl`/`actionType`/`actionIcon` for drill-down
  - Each dashboard declares a structured `header` with action buttons, a `dateRange` global time filter, `globalFilters` (owner / industry / priority lookups), and a `refreshInterval`
  - KPI metric widgets carry `icon`, `format`, and `trend` indicators (direction + delta + label) in `options`, mirroring the objectui reference visual style
  - Chart variety expanded: `area` (revenue trends), `donut` (lead source / industry), `funnel` (pipeline by stage), `gauge` (SLA compliance), `horizontal-bar` (rep ranking), with proper axis titles and value formatters
  - Table widgets use structured `columns: [{ header, accessorKey, format }]` instead of bare field-name arrays
  - New `examples/app-crm/test/dashboard.test.ts` validates every dashboard against `DashboardSchema` and enforces these conventions

### Added
- **Release-readiness documentation pass (42 packages)** — Aligned every `@objectstack/*` package for the formal v4.x release:
  - Canonical README template and `package.json` publishing checklist committed at `docs/internal/PACKAGE_README_TEMPLATE.md`
  - New `packages/services/service-package/README.md` documenting the package registry service
  - All `package.json` files now carry `description`, at least 3 `keywords`, a full `repository` block with `directory`, `homepage`, `bugs`, `engines.node`, `publishConfig.access: public`, and a `files` whitelist
  - `@objectstack/service-tenant` (was `0.1.0`) and `@objectstack/service-package` (was `1.0.0`) bumped to `4.0.4` in lockstep with the release train
  - Rewrote thin READMEs for `core`, `rest`, `driver-memory`, `plugin-security`, and all seven framework adapters (`express`, `fastify`, `hono`, `nestjs`, `nextjs`, `nuxt`, `sveltekit`) to the canonical structure: overview, installation, quick start, key exports, configuration, when/when-not, related packages, and docs links
  - Updated `content/docs/guides/packages.mdx` and `content/docs/concepts/packages.mdx` to reflect the actual **42 package** inventory and to include `service-package` and `service-tenant`

### Fixed
- **Studio left metadata list not refreshing on package switch** — In `apps/studio/src/routes/$package.tsx`, the `AppSidebar` package-switcher's `onSelectPackage` handler only updated local `selectedPackage` state. A URL→state `useEffect` in the same layout then immediately reverted that state back to match the unchanged `$package` route param, so `AppSidebar.loadMetadata` (keyed on `selectedPackage`) never re-ran and the left metadata tree stayed stuck on the previous package. The dropdown now navigates to `/$newPackage`, making the URL the single source of truth; the URL→state effect then updates `selectedPackage` normally and the metadata list refreshes for the new package. (`apps/studio/src/routes/$package.tsx`)
- **Cross-origin auth tokens stripped in `@objectstack/hono` adapter (follow-up to PR #1178)** — `createHonoApp()` was not exposing `set-auth-token` via `Access-Control-Expose-Headers`, diverging from `plugin-hono-server`'s CORS wiring. On Vercel deployments (where all traffic flows through `createHonoApp()`), the browser stripped the header from every response, preventing the better-auth `bearer()` plugin from delivering rotated session tokens to cross-origin clients. Cross-origin sessions silently broke even after the wildcard fixes in #1177/#1178. The adapter now always includes `set-auth-token` in `exposeHeaders`, merged with any user-supplied values, mirroring the invariant established in commit `151dd19c`. (`packages/adapters/hono/src/index.ts`)
- **CORS wildcard patterns in `@objectstack/hono` adapter (follow-up to PR #1177)** — `createHonoApp()` was the third CORS code path that still treated wildcard origins (e.g. `https://*.objectui.org`) as literal strings when passing them to Hono's `cors()` middleware. Because `apps/server` routes all non-OPTIONS requests through this adapter on Vercel, the browser would see a successful preflight (handled by the Vercel short-circuit) followed by a POST/GET response with no `Access-Control-Allow-Origin` header, blocking every real request. The adapter now imports `hasWildcardPattern` / `createOriginMatcher` from `@objectstack/plugin-hono-server` and uses the same matcher-function branch as `plugin-hono-server`, so all three Hono-based CORS paths share a single source of truth. (`packages/adapters/hono/src/index.ts`)
- **CORS wildcard patterns on Vercel deployments** — `CORS_ORIGIN` values containing wildcard patterns (e.g. `https://*.objectui.org,https://*.objectstack.ai,http://localhost:*`) no longer cause browser CORS errors when `apps/server` is deployed to Vercel. The Vercel entrypoint's OPTIONS preflight short-circuit previously matched origins with a literal `Array.includes()`, treating `*` as a plain character and rejecting legitimate subdomains. It now shares the same pattern-matching logic as the Hono plugin's `cors()` middleware via new exports `createOriginMatcher` / `hasWildcardPattern` / `matchOriginPattern` / `normalizeOriginPatterns` from `@objectstack/plugin-hono-server`. (`apps/server/server/index.ts`, `packages/plugins/plugin-hono-server/src/pattern-matcher.ts`)

### Added
- **Claude Code integration (`CLAUDE.md`)** — Added root `CLAUDE.md` file so that [Claude Code](https://docs.anthropic.com/en/docs/claude-code) automatically loads the project's system prompt when launched in the repository. Content is synced with `.github/copilot-instructions.md` and includes build/test quick-reference commands, all prime directives, monorepo structure, protocol domains, coding patterns, and domain-specific prompt references. This complements the existing GitHub Copilot instructions and `skills/` directory.
- **AI Skills documentation pages** — Added two new documentation pages covering the Skills System:
  - `content/docs/concepts/skills.mdx` — Conceptual overview of the skills architecture, philosophy, and structure
  - `content/docs/guides/skills.mdx` — Complete reference for all 10 ObjectStack AI skills with usage examples and prompts
  - Updated top-level navigation to include `concepts` section
  - Added skills links to homepage cards, guides index, and navigation meta files

### Changed
- **Skills Module Structure Refactor** — Refactored all skills in `skills/` directory to follow shadcn-ui's fine-grained layering pattern. Each skill now has:
  - **Concise `SKILL.md`** — High-level overview with decision trees and quick-start examples, referencing detailed rules
  - **`rules/` directory** — Detailed implementation rules with incorrect/correct code examples for better AI comprehension
  - **`evals/` directory** — Placeholder for future evaluation tests to validate AI assistant understanding
  - **Skills refactored:**
    - `objectstack-schema` (formerly `objectstack-data`) — Extracted rules for naming, relationships, validation, indexing, field types, and hooks (moved from objectstack-hooks)
    - `objectstack-plugin` (formerly `objectstack-kernel`) — Extracted rules for plugin lifecycle, service registry, and hooks/events system
    - `objectstack-query` — NEW skill for filters, sorting, pagination, aggregation, joins, expand, full-text search, window functions
    - `objectstack-hooks` — **DEPRECATED** and consolidated into `objectstack-schema/rules/hooks.md` (hooks are core to data operations)
    - `objectstack-ui`, `objectstack-api`, `objectstack-automation`, `objectstack-ai`, `objectstack-i18n`, `objectstack-quickstart` — Added `rules/` and `evals/` structure with initial pattern documentation
  - **Benefits:**
    - Improved maintainability — Detailed rules are separated from high-level overview
    - Better AI comprehension — Incorrect/correct examples make patterns clearer
    - Enhanced testability — `evals/` directory ready for skill validation tests
    - Reduced skill overlap — Hooks integrated into data skill where they belong
    - Preserved skill independence — Each skill remains independently installable/referenceable (no global routing required)

### Fixed
- **Studio tests: failing CI on `main`** — Fixed several long-standing test-suite issues in `@objectstack/studio` that broke the `Test Core` CI job:
  - **Broken relative paths** — Tests in `test/plugins/` used `../src/...` but were two levels deep, causing Vite/Vitest to report `Failed to resolve import "../src/plugins"`. Corrected to `../../src/...`.
  - **`vitest.config.ts` missing required aliases** — The dedicated `vitest.config.ts` only declared the `@` alias while `vite.config.ts` declared ~25 more (e.g. `@objectstack/plugin-auth/objects`, node built-in stubs). Tests that transitively imported `src/mocks/createKernel.ts` failed with `"./objects" is not exported …`. `vitest.config.ts` now mirrors the full alias set used by `vite.config.ts`.
  - **Removed stale tests against non-existent APIs** — Deleted `test/components/AppSidebar.test.tsx`, `test/components/ObjectDataForm.test.tsx`, `test/components/ObjectDataTable.test.tsx`. These were added as scaffolding against APIs that don't match the current components (wrong prop names, missing TanStack Router context) and never passed in CI.
  - **Rewrote `test/plugins/plugin-system.test.tsx`** to match the actual `PluginRegistry` API (`getPlugins`, `getViewers`, `registerAndActivate`, etc.) and `PluginRegistryProvider` async activation lifecycle.
- **Studio: Package switcher not filtering object list** — Fixed a bug where switching packages in the Studio left sidebar did not change the displayed object list. The root cause was in `ObjectStackProtocolImplementation.getMetaItems()`: after filtering items by `packageId` via `SchemaRegistry.listItems()`, the code merged in ALL runtime items from MetadataService without respecting the `packageId` filter, effectively overriding the filtered results. The same issue existed in `HttpDispatcher.handleMetadata()` where the MetadataService fallback path also ignored `packageId`. Both paths now correctly filter MetadataService items by `_packageId` when a package scope is requested.
- **MetadataPlugin driver bridging fallback** — Fixed `MetadataPlugin.start()` so the driver service scan fallback (`driver.*`) is reached when ObjectQL returns `null` (not just when it throws). Previously, `setDatabaseDriver` was never called in environments where ObjectQL was not loaded.
- **Auth trustedOrigins test alignment** — Updated `plugin-auth` tests to match the auto-default `http://localhost:*` behavior added in PR #1152 for better-auth CORS support. When no `trustedOrigins` are configured, the implementation correctly defaults to trusting all localhost ports for development convenience.
- **Docs build: lucide-react module resolution** — Added Turbopack `resolveAlias` in `apps/docs/next.config.mjs` so MDX content files in `content/docs/` (outside the app directory) can resolve `lucide-react`. Turbopack starts module resolution from the file's directory, which doesn't have access to the app's `node_modules/`.
- **Client Hono integration test timeout** — Fixed `afterAll` hook timeout in `client.hono.test.ts` by racing `kernel.shutdown()` against a 10s deadline. The shutdown can hang when pino's worker-thread flush callback never fires in CI, so the race ensures the hook completes within the 30s vitest limit.
- **CI: Replace `pnpm/action-setup@v6` with corepack** — Switched all GitHub Actions workflows (`ci.yml`, `lint.yml`, `release.yml`, `validate-deps.yml`, `pr-automation.yml`) from `pnpm/action-setup@v6` to `corepack enable` to fix persistent `ERR_PNPM_BROKEN_LOCKFILE` errors. Corepack reads the exact `packageManager` field from `package.json` (including SHA verification), ensuring the correct pnpm version is used in CI. Also bumped pnpm store cache keys to v3 and added a pnpm version verification step.
- **Broken pnpm lockfile** — Regenerated `pnpm-lock.yaml` from scratch to fix `ERR_PNPM_BROKEN_LOCKFILE` ("expected a single document in the stream, but found more") that was causing all CI jobs to fail. The previous merge of PR #1117 only included workflow cache key changes but did not carry over the regenerated lockfile.
- **service-ai: Fix navigation item labels using deprecated i18n object format** — Replaced `{ key, defaultValue }` i18n objects with plain string labels in `AIServicePlugin`'s Setup App navigation contributions, completing the `I18nLabelSchema` migration from [#1054](https://github.com/objectstack-ai/framework/issues/1054).

### Added
- **MCP Runtime Server Plugin (`plugin-mcp-server`)** — New kernel plugin that exposes ObjectStack
  as a Model Context Protocol (MCP) server for external AI clients (Claude Desktop, Cursor, VS Code
  Copilot, etc.). Features include:
  - **Tool Bridge**: All registered AI tools from `ToolRegistry` (9 built-in tools: `list_objects`,
    `describe_object`, `query_records`, `get_record`, `aggregate_data`, `create_object`, `add_field`,
    `modify_field`, `delete_field`) are automatically exposed as MCP tools with correct annotations
    (readOnlyHint, destructiveHint).
  - **Resource Bridge**: Object schemas (`objectstack://objects/{objectName}`), object list
    (`objectstack://objects`), record access (`objectstack://objects/{objectName}/records/{recordId}`),
    and metadata types (`objectstack://metadata/types`) exposed as MCP resources.
  - **Prompt Bridge**: Registered agents (`data_chat`, `metadata_assistant`, etc.) exposed as MCP
    prompts with context arguments (objectName, recordId, viewName).
  - **Transport**: stdio transport via `@modelcontextprotocol/sdk` for local AI client integration.
  - **Environment Configuration**: `MCP_SERVER_ENABLED=true` to auto-start, `MCP_SERVER_NAME` and
    `MCP_SERVER_TRANSPORT` for customization.
  - **Extensibility**: `mcp:ready` kernel hook allows other plugins to extend the MCP server.
  - Studio frontend AI interface remains unchanged — it continues to use REST/SSE via
    Vercel Data Stream Protocol.

### Changed
- **Unified `list_objects` / `describe_object` tools (`service-ai`)** — Merged the duplicate
  `list_metadata_objects` → `list_objects` and `describe_metadata_object` → `describe_object`
  tool pairs. Both `data_chat` and `metadata_assistant` agents now share the same unified tools
  with full `filter`, `includeFields`, snake_case validation, and `enableFeatures` support.
  `DATA_TOOL_DEFINITIONS` is reduced from 5 to 3 (query-only tools), while
  `METADATA_TOOL_DEFINITIONS` retains all 6 tools under the unified names. The duplicate
  `ObjectDef`/`FieldDef` type definitions in `data-tools.ts` are removed.

### Fixed
- **MetadataPlugin: Driver bridging for database-backed persistence** — `MetadataPlugin.start()`
  now discovers registered driver services (`driver.*`) from the kernel service registry and
  calls `manager.setDatabaseDriver()` to enable `DatabaseLoader`. Previously, no code bridged
  the kernel's database driver to the `MetadataManager`, leaving `DatabaseLoader` unconfigured
  and metadata persistence limited to the filesystem only.
- **MetadataManager: register() no longer writes to FilesystemLoader** — `register()` now
  persists metadata only to `datasource:` protocol loaders (i.e. `DatabaseLoader`), skipping
  `file:` protocol loaders (`FilesystemLoader`). Previously, `register()` broadcast writes to
  all loaders indiscriminately, causing crashes in read-only environments (e.g. serverless,
  containerized deployments) when `FilesystemLoader.save()` attempted to write to disk.
  The same protocol filter is applied to `unregister()` for consistency.
- **Agent Chat: Vercel SSE Data Stream support** — The agent chat endpoint
  (`/api/v1/ai/agents/:agentName/chat`) now returns Vercel AI SDK v6 UI Message Stream Protocol
  (SSE) by default, matching the general chat endpoint behaviour. Previously, the agent chat route
  only returned plain JSON, causing `DefaultChatTransport` (used by `@ai-sdk/react` `useChat`) to
  fail silently — the API responded correctly but the Studio AI Chat Panel rendered no content.
  The endpoint now uses `streamChatWithTools` + `encodeVercelDataStream` for `stream !== false`
  requests (the default), and falls back to JSON only when `stream: false` is explicitly set.
  Studio's error UI is also enhanced to surface SSE parse failures clearly instead of silent failure.
- **Agent Chat: Vercel AI SDK v6 `parts` format support** — The agent chat endpoint
  (`/api/v1/ai/agents/:agentName/chat`) now accepts Vercel AI SDK v6 `parts`-based message
  format in addition to the legacy `content` string format. Previously, sending messages
  with `parts` (as `useChat` v6 does by default) resulted in a 400 error:
  `"message.content must be a string"`. Shared validation and normalization utilities
  (`validateMessageContent`, `normalizeMessage`) are extracted into `message-utils.ts`
  for reuse across both the general chat and agent chat routes.
- **Studio: Code tab now shows CodeExporter** — The Code tab in Studio metadata detail pages
  now correctly renders the `CodeExporter` component (TypeScript/JSON export with copy-to-clipboard)
  instead of always showing the JSON Inspector preview. The default plugin now registers two separate
  viewers: `json-inspector` for preview mode and `code-exporter` for code mode.
- **CI Test Failures** — Resolved test failures across multiple packages:
  - `@objectstack/service-ai`: Fixed SDK fallback test by mocking `@ai-sdk/openai` dynamic import
    (SDK now available as transitive workspace dependency)
  - `@objectstack/nuxt`, `@objectstack/nextjs`, `@objectstack/fastify`, `@objectstack/sveltekit`:
    Added missing `prefix` argument to `dispatch()` assertion calls in adapter tests
  - `@objectstack/plugin-auth`: Updated `dependencies` assertion and added `manifest` service mock
    to match current plugin implementation

### Added
- **AIServicePlugin Auto-Detection** — AIServicePlugin now automatically detects and initializes
  LLM providers based on environment variables, eliminating the need for manual adapter configuration
  in each deployment:
  - Auto-detection priority: `AI_GATEWAY_MODEL` → `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY`
  - Graceful fallback to MemoryLLMAdapter when no provider is configured
  - Comprehensive logging of selected provider and warnings for missing SDKs
  - Supports custom model selection via `AI_MODEL` environment variable
  - Consistent behavior across CLI, Vercel, Docker, and custom deployments
  - Dynamic import failures are handled as soft errors with automatic fallback
  ([#1067](https://github.com/objectstack-ai/framework/issues/1067))

- **Metadata Versioning & History** — Comprehensive version history tracking and rollback capabilities
  for metadata items. Key features include:
  - `MetadataHistoryRecordSchema` defining structure for historical snapshots
  - `sys_metadata_history` system table for version storage
  - Automatic history tracking in `DatabaseLoader` with SHA-256 checksum deduplication
  - `getHistory()`, `rollback()`, and `diff()` methods in `IMetadataService`
  - REST API endpoints: `GET /history`, `POST /rollback`, `GET /diff`
  - `HistoryCleanupManager` with configurable retention policies (age-based and count-based)
  - Comprehensive test suite covering all history operations

  This aligns ObjectStack with enterprise platforms like Salesforce Setup Audit Trail and
  ServiceNow Update Sets. See `docs/METADATA_HISTORY.md` for detailed usage.

- **CLI: Remote API Commands** - Added 12 new CLI commands for interacting with remote ObjectStack servers:
  - **Authentication**: `os auth login`, `os auth logout`, `os auth whoami`
  - **Data API**: `os data query`, `os data get`, `os data create`, `os data update`, `os data delete`
  - **Metadata API**: `os meta list`, `os meta get`, `os meta register`, `os meta delete`
  - All commands support `--url` and `--token` flags, or use stored credentials from `~/.objectstack/credentials.json`
  - Multiple output formats: `--format json|table|yaml` (yaml available on all commands)
  - Environment variable support: `OBJECTSTACK_URL`, `OBJECTSTACK_TOKEN`
  - See [REMOTE_API_COMMANDS.md](./REMOTE_API_COMMANDS.md) for full documentation

### Changed
- **i18n: `I18nLabelSchema` now accepts `string` only** — `label`, `description`, `title`,
  and other display-text fields across all UI schemas (`AppSchema`, `NavigationArea`,
  `PageSchema`, `DashboardWidgetSchema`, `ReportSchema`, `ChartSchema`, `NotificationSchema`,
  `AriaPropsSchema`, etc.) now accept only plain strings. The previous `string | I18nObject`
  union type has been replaced with `z.string()`. i18n translation keys will be auto-generated
  by the framework at registration time; developers only need to provide the default-language
  string value. Translations are managed through translation files, not inline i18n objects.
  ([#1054](https://github.com/objectstack-ai/framework/issues/1054))

  **Migration:** Replace any `label: { key: '...', defaultValue: 'X' }` with `label: 'X'`.
  Existing plain-string labels require no changes.

  **Affected plugins updated:**
  - `@objectstack/plugin-setup` — `setup-app.ts`, `setup-areas.ts`
  - `@objectstack/plugin-auth` — navigation item labels
  - `@objectstack/plugin-security` — navigation item labels
  - `@objectstack/plugin-audit` — navigation item labels

### Documentation
- **README rewrite** — Rewrote `README.md` to accurately reflect the `objectstack-ai/framework`
  repository. Updates include: corrected title ("ObjectStack Framework"), updated badges
  (v4.0.1, 6,507 tests passing), fixed stale clone URL (`spec.git` → `framework.git`),
  added all missing packages (`driver-sql`, `driver-turso`, `plugin-audit`, `plugin-setup`,
  `service-feed`, `service-automation`, `service-ai`, `service-realtime`, `service-i18n`),
  updated codebase metrics (27 packages, 200 Zod schema files, 1,600+ exported schemas,
  8,750+ `.describe()` annotations, 6,507 tests passing), and restructured sections to
  match the current monorepo layout.

### Fixed
- **AI Chat agent selector missing `data_chat` and `metadata_assistant`** — Fixed `GET /api/v1/ai/agents`
  returning 404, which caused the Studio AI Chat panel to show only "General Chat". There were two
  root causes addressed by this fix:
  1. **Kernel bootstrap timing** (`packages/core/src/kernel.ts`): 'core' service in-memory fallbacks
     (e.g. the 'metadata' service) were only injected in `validateSystemRequirements()` which runs
     AFTER all plugin `start()` methods execute. This meant `ctx.getService('metadata')` always threw
     during `AIServicePlugin.start()` when no explicit `MetadataPlugin` was loaded. Fix: added
     `preInjectCoreFallbacks()` called between Phase 1 (init) and Phase 2 (start), ensuring all core
     service fallbacks are available before any plugin's `start()` runs.
  2. **Shadowed variable** (`packages/services/service-ai/src/plugin.ts`): a redundant second
     `ctx.getService('metadata')` call declared a new `const metadataService` that shadowed the outer
     `let metadataService` and failed silently, preventing `buildAgentRoutes()` from being called even
     if the metadata service was available. Fix: reuse the already-resolved outer variable.
  Additionally, added a fallback in `DispatcherPlugin.start()` that recovers AI routes from the
  `kernel.__aiRoutes` cache in case the `ai:routes` hook fires before the listener is registered
  (timing edge case).
- **ObjectQLPlugin: cold-start metadata restoration** — `ObjectQLPlugin.start()` now calls
  `protocol.loadMetaFromDb()` after driver initialization and before schema sync, restoring
  all persisted metadata (objects, views, apps, etc.) from the `sys_metadata` table into the
  in-memory `SchemaRegistry`. Previously, user-created custom objects were lost after kernel
  cold starts or redeployments because the hydration step was missing. The fix gracefully
  degrades in in-memory-only or first-run scenarios where `sys_metadata` does not yet exist.
- **Studio Vercel API routes returning HTML instead of JSON** — Adopted the
  same Vercel deployment pattern used by `hotcrm`: committed
  `api/[[...route]].js` catch-all route so Vercel detects it pre-build,
  switched esbuild output from CJS to ESM (fixes `"type": "module"` conflict),
  and changed the bundle output to `api/_handler.js` (a separate file that
  the committed wrapper re-exports).  This avoids both Vercel's TS
  compilation overwriting the bundle (`ERR_MODULE_NOT_FOUND`) and the
  "File not found" error from deleting source files during build.
  Added `createRequire` banner to the esbuild config so that CJS
  dependencies (knex/tarn) can `require()` Node.js built-in modules like
  `events` without the "Dynamic require is not supported" error.
  Added `functions.includeFiles` in `vercel.json` to include native addons
  (`better-sqlite3`, `@libsql/client`) that esbuild cannot bundle.
  Added a build step to copy native external modules from the monorepo root
  `node_modules/` into the studio's local `node_modules/`, since pnpm's strict
  mode (unlike hotcrm's `shamefully-hoist`) doesn't symlink transitive native
  dependencies into app-level `node_modules/`.
  Updated rewrites to match: `/api/:path*` → `/api/[[...route]]`.
- **Studio CORS error on Vercel temporary/preview domains** — Changed
  `VITE_SERVER_URL` from hardcoded `https://play.objectstack.ai` to `""`
  (empty string / same-origin) in `vercel.json` so each deployment — including
  previews — calls its own serverless function instead of the production API
  cross-origin.  Also added Hono CORS middleware to `apps/studio/server/index.ts`
  as a safety net for any remaining cross-origin scenarios; dynamically allows
  all `*.vercel.app` subdomains, explicitly listed Vercel deployment URLs, and
  localhost.  Extracted `getVercelOrigins()` helper to keep CORS and
  better-auth `trustedOrigins` allowlists in sync.
- **Client test aligned with removed `ai.chat` method** — Updated
  `@objectstack/client` test suite to match the current API surface where
  `ai.chat()` was removed in favour of the Vercel AI SDK `useChat()` hook.
  The obsolete test that called `client.ai.chat()` now asserts the method is
  absent, fixing the CI `@objectstack/client#test` failure.

### Added
- **Metadata Assistant Agent (`service-ai`)** — New `metadata_assistant` agent definition that
  binds all 6 metadata management tools (`create_object`, `add_field`, `modify_field`,
  `delete_field`, `list_objects`, `describe_object`). Includes a tailored
  system prompt that guides the AI to use snake_case naming, verify existing schemas before
  modifications, and warn about destructive operations. Configured with `react` planning
  strategy (10 iterations, replan enabled) for multi-step schema design conversations.
- **Tool Confirmation Flags** — Added `requiresConfirmation: true` to `create_object` and
  `delete_field` tool definitions. These destructive/creation operations now signal to the
  frontend that user approval is needed before execution.
- **Frontend Tool Call Display (`AiChatPanel`)** — Enhanced the AI Chat Panel to render tool
  invocation parts from the Vercel AI SDK v6 stream protocol. Displays tool call status with
  visual indicators:
  - **Calling**: Spinner animation with tool name and argument summary
  - **Confirmation**: Yellow-bordered card with Approve/Deny buttons for `requiresConfirmation` tools
  - **Success**: Green success indicator with result preview
  - **Error**: Red error indicator with error message
  - **Denied**: Muted indicator for user-denied operations
- **Operation Confirmation Mechanism** — Integrated the Vercel AI SDK `addToolApprovalResponse`
  hook to support approval/denial workflows for tools marked with `requiresConfirmation`.
  When the server sends an `approval-requested` state, the chat panel shows Approve and Deny
  buttons. User decisions are sent back to the server to continue or abort the tool execution.
- **Metadata Management Tools (`service-ai`)** — Added 6 built-in AI tools for metadata
  CRUD operations, each defined as a first-class `Tool` metadata file using `defineTool()`
  from `@objectstack/spec/ai`:
  - `create-object.tool.ts` — Creates a new data object with schema validation
  - `add-field.tool.ts` — Adds a field to an existing object
  - `modify-field.tool.ts` — Modifies field properties on an object
  - `delete-field.tool.ts` — Removes a field from an object
  - `list-metadata-objects.tool.ts` — Lists all registered metadata objects
  - `describe-metadata-object.tool.ts` — Returns full schema details of an object
  
  Each `.tool.ts` file is an independent metadata unit with `name`, `label`, `description`,
  `category`, `builtIn`, and `parameters` — following the same `.object.ts` / `.view.ts`
  metadata file convention. Handler factories remain in `metadata-tools.ts` and bind handlers
  at `ai:ready` time via `registerMetadataTools(registry, { metadataService })`.
  79 unit tests covering tool metadata properties, handler execution, input validation,
  error handling, dual registration with data tools, and a full lifecycle test.
- **Agent Skills — `skills/` directory (agentskills.io)** — Created `skills/` folder at
  repository root following the [agentskills.io specification](https://agentskills.io/specification).
  Five expert-knowledge skills with hand-written `SKILL.md` files and `references/` quick-lookup
  tables:
  - `skills/schema-design/` — Data schema design (Object, Field, Validation, Index)
  - `skills/ui-design/` — UI protocol (View, App, Dashboard, Report, Action)
  - `skills/automation-design/` — Automation (Flow, Workflow, Trigger, Approval)
  - `skills/ai-agent-design/` — AI Agent protocol (Agent, Skill, RAG, Tool)
  - `skills/api-design/` — API protocol (REST endpoints, Discovery, Datasource)
  Each `SKILL.md` includes YAML frontmatter (`name`, `description`, `license`, `metadata`),
  domain rules, usage guidance, best practices, common pitfalls, and code examples.
  Zod schema files remain the single source of truth; skills reference them for validation.
- **Discovery Schema — `ServiceStatus` enum & `handlerReady` field** — Added `'registered'`
  status to `ServiceInfoSchema` to distinguish routes that are declared in the dispatcher
  table but whose HTTP handler has not been verified. Added optional `handlerReady` boolean
  field (omitted = unverified/unknown) so clients can filter handler-ready services before
  displaying endpoints when the value is explicitly `true`.
- **Discovery Schema — `RouteHealthReportSchema`** — New schema for automated route/handler
  coverage reporting at startup. Includes per-route health entries (`pass`, `fail`, `missing`,
  `skip`) and summary counters.
- **Dispatcher Schema — `DispatcherErrorCode` & `DispatcherErrorResponseSchema`** — Semantic
  error codes (`404`/`405`/`501`/`503`) with machine-readable `type` field
  (`ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `NOT_IMPLEMENTED`, `SERVICE_UNAVAILABLE`) and
  developer-facing `hint` strings.
- **Dispatcher Schema — `/health` route** — Added health endpoint to `DEFAULT_DISPATCHER_ROUTES`.
- **REST API Plugin — `handlerStatus` field** — Added `handlerStatus` (`implemented`, `stub`,
  `planned`) to `RestApiEndpointSchema` to track handler implementation readiness.
- **REST API Plugin — `RouteCoverageReportSchema`** — Schema for adapter-generated coverage
  reports listing every declared endpoint and its implementation status.
- `ai` v6 as a dependency of `@objectstack/spec` for type re-exports

### Removed
- **Removed `value` field from data API responses** — The `findData` protocol
  implementation no longer returns the deprecated `value` field alongside `records`.
  Only `records` is returned, matching the `FindDataResponseSchema` spec. All
  downstream consumers (Studio, server example, tests) updated to use `records`
  exclusively. OData-specific responses (`ODataResponseSchema`) retain `value` per
  the OData v4 standard — protocol-to-OData adaptation is handled in the HTTP
  dispatch layer.

### Changed
- **AI Chat Protocol Aligned with Vercel AI SDK** — Removed custom AI chat protocol
  types and Zod schemas (`AIMessage`, `AIToolCall`, `AIStreamEvent`,
  `AiChatRequestSchema`, `AiChatResponseSchema`) from `@objectstack/spec`. The
  canonical message, tool-call, and streaming types are now re-exported from the
  Vercel AI SDK (`ai` v6):
  - `ModelMessage` replaces `AIMessage`
  - `ToolCallPart` replaces `AIToolCall`
  - `ToolResultPart` replaces `AIToolResult`
  - `TextStreamPart<ToolSet>` replaces `AIStreamEvent`
  - `IAIService` and `LLMAdapter` method signatures now accept `ModelMessage[]`
    and return `TextStreamPart<ToolSet>` for streaming
  - Deprecated type aliases preserved for migration convenience
  - NLQ, Suggest, and Insights protocols (ObjectStack-specific) are retained
- **`@objectstack/service-ai` migrated to Vercel AI SDK types** — All source files
  and tests now use canonical Vercel types (`ModelMessage`, `ToolCallPart`,
  `ToolResultPart`, `TextStreamPart<ToolSet>`) instead of deprecated aliases:
  - `ToolRegistry.execute()` accepts `ToolCallPart` and returns `ToolExecutionResult`
    (extends `ToolResultPart` with `isError?: boolean`)
  - Tool call loop in `AIService.chatWithTools()` constructs proper
    `AssistantModelMessage` and `ToolModelMessage` with Vercel-format content arrays
  - `MemoryLLMAdapter.streamChat()` emits Vercel `TextStreamPart<ToolSet>` events
  - Conversation services serialize/deserialize `ModelMessage` union to flat DB columns
  - All 158 service-ai tests updated and passing

### Fixed
- **Runtime Dispatcher — semantic error differentiation** — `HttpDispatcher.dispatch()` now
  returns typed 404 (`ROUTE_NOT_FOUND`) with diagnostic info instead of bare `{ handled: false }`.
  Added `routeNotFound()` (404) helper method.
- **Runtime Dispatcher — `/health` handler** — Added health endpoint returning `status`,
  `timestamp`, `version`, and `uptime`.
- **Runtime Dispatcher — `handlerReady` in discovery** — `getDiscoveryInfo()` now emits
  `handlerReady: true` for services with confirmed handlers and `handlerReady: false` for
  unavailable services.
- **Dispatcher Plugin — semantic 404** — `sendResult()` now returns `ROUTE_NOT_FOUND` error
  type with a hint pointing to the discovery endpoint. Added `/health` handler registration.
- **Studio — handler-ready filtering** — `useApiDiscovery()` now checks both `enabled` and
  `handlerReady` (or `status === 'available' | 'degraded'` for backward compatibility) before
  displaying service endpoints in the UI.

### Removed
- `AiChatRequestSchema` / `AiChatResponseSchema` Zod schemas from
  `@objectstack/spec/api` — the AI chat wire protocol now uses Vercel AI SDK's
  data stream format (`toDataStreamResponse()`)
- `aiChat` method from `IObjectStackAPI` and client SDK — consumers should use
  `@ai-sdk/react/useChat` directly
- AI `/chat` endpoint from `DEFAULT_AI_ROUTES` plugin REST API definition

### Added
- `ai` v6 as a dependency of `@objectstack/spec` for type re-exports
- **Vercel AI Data Stream Protocol support on `/api/v1/ai/chat`** — The chat
  endpoint now supports dual-mode responses:
  - **Streaming (default)**: When `stream` is not `false`, returns Vercel Data
    Stream Protocol frames (`0:` text, `9:` tool-call, `d:` finish, etc.),
    directly consumable by `@ai-sdk/react/useChat`
  - **JSON (legacy)**: When `stream: false`, returns the original JSON response
  - Accepts Vercel useChat flat body format (`system`, `model`, `temperature`,
    `maxTokens` as top-level fields) alongside the legacy `{ messages, options }`
  - `systemPrompt` / `system` field is prepended as a system message
  - Message validation now accepts Vercel multi-part array content
  - `RouteResponse.vercelDataStream` flag signals HTTP server layer to encode
    events using the Vercel Data Stream frame format
- **`VercelLLMAdapter`** — Production adapter wrapping Vercel AI SDK's
  `generateText` / `streamText` for any compatible model provider (OpenAI,
  Anthropic, Google, Ollama, etc.)
- **`vercel-stream-encoder.ts`** — Utilities (`encodeStreamPart`,
  `encodeVercelDataStream`) to convert `TextStreamPart<ToolSet>` events into
  Vercel Data Stream wire-format frames
- 176 service-ai tests passing (18 new tests for stream encoder, route
  dual-mode, systemPrompt, flat options, array content)

## [4.0.1] — 2026-03-31

### Fixed
- **Version Alignment Patch** — Unified all package versions to `4.0.1`. Previously,
  `@objectstack/driver-sql` and `@objectstack/driver-turso` were at `3.3.2`, example
  packages were at `3.0.26`, and the root monorepo was at `3.0.8` while all other
  `@objectstack/*` packages were at `4.0.0`. All packages now share a single, consistent
  version number aligned with the changeset `fixed` group configuration.

### Added
- **`@objectstack/service-realtime` — `sys_presence` System Object** — Registers the
  `sys_presence` system object in the `service-realtime` package as the canonical Presence
  domain object. Fields align with the `PresenceStateSchema` protocol definition
  (`user_id`, `session_id`, `status`, `last_seen`, `current_location`, `device`,
  `custom_status`, `metadata`). `RealtimeServicePlugin` now auto-registers the object
  via the `app.com.objectstack.service.realtime` service convention. Added
  `SystemObjectName.PRESENCE` constant (`'sys_presence'`) to `@objectstack/spec/system`.
- **`@objectstack/service-ai` — Data Chatbot: Tool Call Loop & Agent Runtime** — Implements
  an Airtable Copilot-style data conversation Chatbot with full-stack support:
  - `AIService.chatWithTools()` — automatic multi-round LLM ↔ tool call loop with
    `maxIterations` safety limit, parallel tool execution, and forced final response
  - `AIResult.toolCalls` — new field on the AI result contract so adapters can return
    tool call requests from the LLM
  - `ChatWithToolsOptions` — new contract interface extending `AIRequestOptions`
  - 5 built-in data tools: `list_objects`, `describe_object`, `query_records`,
    `get_record`, `aggregate_data` — with parameter schemas, limit capping (max 200),
    and error handling
  - `registerDataTools(registry, context)` — factory to register all data tools
    against `IDataEngine` + `IMetadataService`
  - `AgentRuntime` — loads agent metadata, builds system prompts from instructions +
    UI context (`objectName`, `recordId`, `viewName`), resolves agent tool references
    against the `ToolRegistry`
  - `buildAgentRoutes()` — new `POST /api/v1/ai/agents/:agentName/chat` route with
    agent lookup, active-check, context injection, and `chatWithTools` integration
  - `DATA_CHAT_AGENT` — built-in `data_chat` agent spec with role, instructions,
    guardrails, planning config, and tool declarations
  - `AIServicePlugin` auto-registers data tools and `data_chat` agent when
    `IDataEngine` + `IMetadataService` are available in the kernel
  - 42 new test cases covering tool call loop, data tools, agent runtime, agent
    routes, and agent spec validation
- **`@objectstack/service-ai` — ObjectQL-backed persistent ConversationService** — New
  `ObjectQLConversationService` implements `IAIConversationService` using `IDataEngine`
  for durable conversation and message storage across service restarts:
  - `ai_conversations` and `ai_messages` system object definitions (namespace `ai`)
  - Full CRUD: `create`, `get`, `list` (with userId/agentId/limit/cursor filters),
    `addMessage` (with toolCalls/toolCallId support), and `delete` (cascade)
  - `AIServicePlugin` auto-detects `IDataEngine` in the kernel service registry and
    uses `ObjectQLConversationService` when available, falling back to
    `InMemoryConversationService` for dev/test environments
  - `AIServicePluginOptions.conversationService` allows explicit override
  - Plugin registers AI system objects via `app.com.objectstack.service-ai` service
  - 16 new test cases covering all five interface methods plus edge cases
- **Promoted `LLMAdapter` interface to `@objectstack/spec/contracts`** — Moved the `LLMAdapter`
  adapter contract from `@objectstack/service-ai` internal types to the canonical protocol layer
  (`packages/spec/src/contracts/llm-adapter.ts`). Third-party adapter implementations (OpenAI,
  Anthropic, Ollama, etc.) can now depend solely on `@objectstack/spec` for type alignment.
  `service-ai` re-exports the interface for backward compatibility.

### Fixed
- **Changeset fixed versioning — add driver-sql and driver-turso** — Added `@objectstack/driver-sql`
  and `@objectstack/driver-turso` to the changeset `fixed` versioning group in `.changeset/config.json`.
  These packages were missing from the group, causing them to be published as `3.3.2` instead of `4.0.0`
  during the v4.0.0 release. All future releases will now keep these driver packages in sync with the
  rest of the ecosystem.
- **ObjectQL build failure** — Fixed TypeScript TS2345 errors in `packages/objectql/src/protocol.ts`
  where `SchemaRegistry.registerItem()` calls failed type checking for the `keyField` parameter.
  Applied `'name' as any` cast consistent with the established codebase pattern.
- **ObjectQL `loadMetaFromDb`** — Fixed metadata hydration for `object` type records to use
  `SchemaRegistry.registerObject()` instead of `registerItem()`, resolving a mismatch where
  objects registered via `registerItem` could not be retrieved via `getItem('object', ...)`.
- **Adapter discovery endpoints** — Fixed discovery route in Hono, SvelteKit, Nuxt, Next.js,
  and Fastify adapters to serve discovery info at the API prefix root (e.g., `GET /api`)
  instead of a `/discovery` subpath. Updated `.well-known/objectstack` redirects accordingly.
- **Client feed namespace routing** — Fixed `ObjectStackClient.feed` methods to use the `data`
  route (`/api/v1/data/{object}/{recordId}/feed`) instead of a separate `/api/v1/feed` route,
  matching the actual server-side routing where feed is a sub-resource of data.

### Added
- **`@objectstack/service-ai` — Unified AI capability service plugin** — New kernel plugin
  providing standardized AI service integration:
  - Registers as kernel `'ai'` service conforming to `IAIService` contract
  - LLM adapter layer with provider abstraction (`LLMAdapter` interface) and built-in
    `MemoryLLMAdapter` for testing/development
  - `ToolRegistry` for metadata/business tool registration and execution
  - `InMemoryConversationService` implementing `IAIConversationService` for multi-turn
    conversation management with message persistence
  - REST/SSE route self-registration (`/api/v1/ai/chat`, `/api/v1/ai/chat/stream`,
    `/api/v1/ai/complete`, `/api/v1/ai/models`, `/api/v1/ai/conversations`)
  - Plugin lifecycle hooks (`ai:ready`, `ai:routes`) for extensibility
- **Expanded `IAIService` contract** — Added streaming (`streamChat`), tool calling protocol
  (`AIToolDefinition`, `AIToolCall`, `AIToolResult`, `AIMessageWithTools`,
  `AIRequestOptionsWithTools`, `AIStreamEvent`), and conversation management
  (`IAIConversationService`, `AIConversation`) to `packages/spec/src/contracts/ai-service.ts`
- **`@objectstack/plugin-setup` — Platform Setup App plugin** — New internal plugin
  (`packages/plugins/plugin-setup`) that owns and finalizes the platform Setup App.
  Ships four built-in Setup Areas (Administration, Platform, System, AI) as empty
  skeletons. Other plugins contribute navigation items via the `setupNav` service
  during their `init` phase. At `start`, SetupPlugin merges all contributions,
  filters out empty areas, and registers the finalized Setup App as an internal
  platform app. This establishes clear architectural separation: **spec** = protocol
  only, **objectql** = data/query only, **plugins** = system feature and UI composition.

### Documentation
- **Unified API query syntax documentation with Spec canonical format** — Rewrote
  `content/docs/protocol/objectql/query-syntax.mdx` and
  `content/docs/guides/contracts/data-engine.mdx` to align all examples, interface
  definitions, and field names with the canonical `QuerySchema`, `FilterConditionSchema`,
  and `EngineQueryOptionsSchema` from `@objectstack/spec`. All query examples now use
  `where` + MongoDB-style `$op` object syntax (replacing legacy tuple/`filters`/三元组
  format), `orderBy` (replacing `sort`), `groupBy` (replacing `group_by`), and
  `aggregations` array (replacing `aggregate` object map). `IDataEngine` contract
  documentation updated to reflect the real interface (`find`/`findOne`/`insert`/
  `update`/`delete`/`count`/`aggregate`). Added legacy compatibility sections clearly
  marking tuple/array syntax as UI-builder input only, with migration guidance.

### Changed
- **Studio Vercel deployment — switched from InMemoryDriver to TursoDriver** — The Studio serverless
  API entrypoint (`apps/studio/api/index.ts`) now uses `@objectstack/driver-turso` (TursoDriver)
  instead of `@objectstack/driver-memory` (InMemoryDriver) for Vercel deployments. In production,
  the driver connects to a Turso cloud database via `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
  environment variables (remote mode). For local development without those variables, it falls back
  to `:memory:` (ephemeral SQLite). This ensures data persistence across serverless function
  invocations on Vercel. The browser MSW mock kernel remains unchanged (InMemoryDriver).

### Fixed
- **Metadata DB persistence — `saveMetaItem()` now writes to database** — The protocol
  implementation (`ObjectStackProtocolImplementation.saveMetaItem()`) now persists metadata
  to the `sys_metadata` table via `IDataEngine` in addition to the in-memory `SchemaRegistry`.
  Previously, metadata saved via `PUT /api/v1/meta/:type/:name` was lost on server restart.
  Added `loadMetaFromDb()` bootstrap method to hydrate the registry from the database on
  startup. `getMetaItem()` and `getMetaItems()` now fall back to database queries when items
  are not found in the in-memory registry. Discovery endpoint metadata status upgraded from
  `degraded` to `available`. Graceful degradation: if the database is unavailable, operations
  fall back to memory-only mode with a warning.
- **Vercel API always returns HTML — serverless function entrypoint not found** — The `bundle-api.mjs`
  script was emitting `api/index.js` at the project root, but `vercel.json` sets `outputDirectory: "dist"`,
  so Vercel could not discover the serverless function and fell back to the SPA HTML route for all
  `/api/*` requests. Changed esbuild `outfile` to `dist/api/index.js` and added explicit `functions`
  config in `vercel.json` with `@vercel/node@3` runtime.

### Added
- **Batch schema sync for remote DDL in kernel bootstrap** — `ObjectQLPlugin.syncRegisteredSchemas()`
  now groups objects by driver and uses `syncSchemasBatch()` when the driver advertises
  `supports.batchSchemaSync = true`. This reduces the number of remote DDL round-trips from
  roughly N×(2–3) individual calls (introspection + optional PRAGMA + DDL write per object)
  to a small constant number of batched `client.batch()` calls, cutting cold-start times from
  58+ seconds to under 10 seconds for 100+ objects on remote drivers (e.g. Turso cloud).
  Falls back to sequential `syncSchema()` per object for drivers without batch support or if the
  batched calls fail at runtime. Added `batchSchemaSync` capability flag to `DriverCapabilitiesSchema`,
  optional `syncSchemasBatch()` to `IDataDriver`, and `RemoteTransport.syncSchemasBatch()` using
  `@libsql/client`'s `batch()` API.
- **`@objectstack/driver-turso` — dual transport architecture** — TursoDriver now supports three
  transport modes: `local`, `replica`, and `remote`. Remote mode (`url: 'libsql://...'`) enables
  pure cloud-only queries via `@libsql/client` SDK (HTTP/WebSocket) without requiring a local
  SQLite database or Knex. Transport mode is auto-detected from the URL or can be forced via
  `config.mode`. The driver exposes `transportMode` and `isRemote` properties for runtime
  introspection. All IDataDriver methods (CRUD, bulk, transactions, schema sync) work identically
  across all modes. Added `RemoteTransport` class, `TursoTransportMode` type, and support for
  injecting a pre-configured `@libsql/client` instance via `config.client`.

### Fixed
- **Vercel deployment — `ERR_MODULE_NOT_FOUND` for `@objectstack/metadata`** — Fixed incorrect
  `exports` paths in `@objectstack/metadata` `package.json` that pointed directly to TypeScript
  source files (`src/index.ts`, `src/node.ts`) instead of compiled dist output. Node.js cannot
  import `.ts` files at runtime, causing `ERR_MODULE_NOT_FOUND` on Vercel. Updated `main`, `types`,
  and `exports` to reference dist files (`dist/index.js`, `dist/index.mjs`, `dist/node.mjs`, etc.).
  Added a local `tsup.config.ts` with both entry points (`src/index.ts`, `src/node.ts`) and a
  `files` field to the package.json. Follows the same pattern as `@objectstack/spec`.
- **Vercel deployment — `ERR_MODULE_NOT_FOUND` for `@objectstack/service-feed`** — Fixed incorrect
  `exports` paths in `package.json` for all service packages that declare `"type": "module"`. When
  `tsup` builds an ESM package (`"type": "module"`), it outputs `.js` for ESM and `.cjs` for CJS.
  However, the exports maps incorrectly referenced `.mjs` (ESM) and `.js` (CJS) — the convention
  for packages *without* `"type": "module"`. This caused Node's ESM resolver to fail with
  `ERR_MODULE_NOT_FOUND` when Vercel tried to import `dist/index.mjs` (which doesn't exist).
  Affected packages: `service-feed`, `service-automation`, `service-cache`, `service-realtime`,
  `service-job`, `service-queue`, `service-storage`, `service-analytics`.
- **`@objectstack/driver-sql` DTS build failure — knex type resolution** — Fixed a TypeScript
  declaration build failure caused by knex v3.2.3 declaring a non-existent `.d.mts` types file
  in its package.json `exports` field. With `moduleResolution: "bundler"`, TypeScript could not
  resolve knex's type declarations, resulting in TS7016 and TS7006 errors during DTS generation.
  Added a `paths` mapping in the driver-sql `tsconfig.json` to direct TypeScript to the correct
  `knex/types/index.d.ts` file. This also fixes cascade build failures in all downstream
  packages that depend on driver-sql.
- **`SqlDriver.syncSchema()` — physical table name mismatch** — Fixed the root cause of the
  `no such table: sys_user` error: `syncSchema()` was ignoring the `object` parameter (physical
  table name like `sys_user`) and using `schema.name` (FQN like `sys__user`) for DDL operations.
  The method now correctly passes the physical table name to `initObjects()`. Additionally,
  `initObjects()` now supports a `tableName` property as defense-in-depth, preferring it over
  `name` when both are present.
- **Login API error — database tables not created** — Fixed a critical naming mismatch between
  the FQN (Fully Qualified Name) used by SchemaRegistry (e.g., `sys__user` with double underscore)
  and the physical table name derived by `ObjectSchema.create()` (e.g., `sys_user` with single
  underscore). `syncRegisteredSchemas()` now uses the `tableName` property from object definitions
  for DDL operations, ensuring tables are created with the correct physical name that matches
  what the auth adapter and `SystemObjectName` constants expect.
- **`SchemaRegistry.getObject()` — protocol name resolution** — Added a third fallback that
  matches objects by their `tableName` property (e.g., `getObject('sys_user')` now correctly
  finds the object registered as FQN `sys__user`). This bridges protocol-layer names
  (`SystemObjectName.USER = 'sys_user'`) with the registry's FQN naming convention.
- **`ObjectQL.resolveObjectName()` — physical table name** — Now returns `schema.tableName`
  (the physical table/collection name) instead of `schema.name` (the FQN) when available,
  ensuring driver SQL queries target the correct table.
- **`SqlDriver.ensureDatabaseExists()` — multi-driver support** — Extended database
  auto-creation to support MySQL (error code `ER_BAD_DB_ERROR` / errno 1049) alongside
  PostgreSQL (error code `3D000`). SQLite is explicitly skipped (auto-creates files).
- **`SqlDriver.createDatabase()` — MySQL support** — Added MySQL-specific logic that
  connects without a database specified and uses `CREATE DATABASE IF NOT EXISTS`.

### Added
- **`@objectstack/driver-turso` plugin** — Migrated and standardized the Turso/libSQL driver from
  `@objectql/driver-turso` into `packages/plugins/driver-turso/`. The driver **extends** `SqlDriver`
  from `@objectstack/driver-sql` — all CRUD, schema, filter, aggregation, and introspection logic
  is inherited with zero code duplication. Turso-specific features include: three connection modes
  (local file, in-memory, embedded replica), `@libsql/client` sync mechanism for embedded replicas,
  multi-tenant router with TTL-based driver caching, and enhanced capability flags (FTS5, JSON1,
  CTE, savepoints, indexes). Includes 53 unit tests. Factory function `createTursoDriver()` and
  plugin manifest for kernel integration.
- **Multi-tenant routing** (`createMultiTenantRouter`) — Database-per-tenant architecture with
  automatic driver lifecycle management, tenant ID validation, configurable TTL cache, and
  `onTenantCreate`/`onTenantEvict` lifecycle callbacks. Serverless-safe (no global intervals).

### Changed
- **`@objectstack/driver-sql` — Protected extensibility** — Changed `private` to `protected` for
  all internal properties and methods (`knex`, `config`, `jsonFields`, `booleanFields`,
  `tablesWithTimestamps`, `isSqlite`, `isPostgres`, `isMysql`, `getBuilder`, `applyFilters`,
  `applyFilterCondition`, `mapSortField`, `mapAggregateFunc`, `buildWindowFunction`,
  `createColumn`, `ensureDatabaseExists`, `createDatabase`, `isJsonField`, `formatInput`,
  `formatOutput`, `introspectColumns`, `introspectForeignKeys`, `introspectPrimaryKeys`,
  `introspectUniqueConstraints`). Enables clean subclassing for driver variants (Turso, D1, etc.)
  without code duplication.

### Fixed
- **`@objectstack/driver-sql` — `count()` returns NaN for zero results** — Fixed `count()` method
  using `||` (logical OR) instead of `??` (nullish coalescing) to read the count value. When the
  actual count was `0`, `row.count || row['count(*)']` evaluated to `Number(undefined)` = `NaN`
  because `0` is falsy. Now uses `row.count ?? row['count(*)'] ?? 0` for correct zero handling.

### Changed
- **Unified Data Driver Contract (`IDataDriver`)** — Resolved the split between `DriverInterface`
  (core, minimal ~13 methods) and `IDataDriver` (spec, comprehensive 28 methods). `IDataDriver`
  from `@objectstack/spec/contracts` is now the **single authoritative** contract for all database
  driver implementations. `DriverInterface` is retained as a deprecated type alias for backward
  compatibility. Both `@objectstack/driver-sql` and `@objectstack/driver-memory` now implement
  `IDataDriver` directly with full `DriverCapabilities` support.
- **`@objectstack/driver-sql`** — Added missing `IDataDriver` methods: `findStream`, `upsert`,
  `bulkUpdate`, `bulkDelete`, `commit`, `rollback`, `dropTable`, `explain`. Aligned `supports`
  with full `DriverCapabilities` schema. `updateMany`/`deleteMany` now return `number` (count)
  instead of `{ modifiedCount }` / `{ deletedCount }` objects. `delete` returns `boolean`.
- **`@objectstack/driver-memory`** — Aligned `supports` property with full `DriverCapabilities`
  schema (added `create`, `read`, `update`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkDelete`,
  `savepoints`, `queryCTE`, `jsonQuery`, `geospatialQuery`, `streaming`, `schemaSync`, etc.).

### Removed
- **`@objectstack/driver-sql` — Legacy query key fallbacks** — Removed support for deprecated
  query keys `filters` (use `where`), `sort` (use `orderBy`), `skip` (use `offset`), and `top`
  (use `limit`) from `find`, `updateMany`, `deleteMany`, and `count` methods. The SQL driver now
  strictly follows the `IDataDriver` / `QueryAST` protocol. All `as any` casts for legacy key
  access have been eliminated. Tests updated to use only standard `QueryAST` keys.

### Deprecated
- **`DriverInterface`** — Use `IDataDriver` from `@objectstack/spec/contracts` instead.
  `DriverInterface` remains as a type alias in both `@objectstack/spec/contracts` and
  `@objectstack/core` for backward compatibility.

### Added
- **`@objectstack/driver-sql` plugin** — Migrated the Knex-based SQL driver from `@objectql/driver-sql`
  into `packages/plugins/driver-sql/`. The driver implements the standard `DriverInterface` from
  `@objectstack/core` and imports types from `@objectstack/spec/data`. Supports PostgreSQL, MySQL,
  and SQLite (via `better-sqlite3`). Includes schema sync, introspection, aggregation, window
  functions, transactions, and full CRUD with both QueryAST and legacy filter format support.
  All 72 unit tests pass against in-memory SQLite.

### Changed
- **Migrate API layer to Hono + Vercel Node adapter** — Replaced the vestigial Next.js-style
  `api/[...path].ts` catch-all with a proper `api/index.ts` Hono entrypoint using `handle(app)`
  from `hono/vercel`. Vercel routes now use a rewrite rule (`/api/*` → `/api`) for native Hono
  routing, eliminating path-normalisation hacks and catch-all bundling pitfalls. Kernel boot
  remains lazy (cold-start only) via `ensureApp()` / `ensureKernel()` in `_kernel.ts`.

### Fixed
- **Service-analytics build error (TS6133)** — Removed unused `measure` variable in
  `native-sql-strategy.ts` that caused the DTS build to fail with `noUnusedLocals` enabled,
  blocking the entire CI build pipeline.
- **Next.js adapter test failures** — Updated 9 metadata API test assertions to match the
  current `dispatch(method, path, body, queryParams, context)` call signature used by the
  implementation. Tests were still expecting the old `dispatch(subPath, context, method, body)`
  signature.
- **Auth plugin test failures** — Fixed 2 tests in `auth-plugin.test.ts` that referenced the
  wrong `AuthManager` instance via `registerService.mock.calls`. Added `mockClear()` before
  local plugin init to ensure `mock.calls[0]` points to the correct AuthManager for the test's
  plugin instance.
- **SvelteKit adapter test failures** — Updated test mock to include `dispatch()` method and
  aligned Metadata, Data, Error handling, and toResponse test assertions with the unified
  catch-all dispatch pattern used by the implementation and all other adapters (e.g. Hono).
  Removed obsolete `handleMetadata`/`handleData` references from the mock.
- **Vercel serverless 404 fix** — The previous `api/[...path].ts` path-normalisation fix is now
  superseded by the Hono adapter migration above. The new `api/index.ts` entrypoint combined with
  Vercel rewrites (`/api/*` → `/api`) eliminates the routing ambiguity that caused 404s.
- **Kernel cold-start race condition** — `api/_kernel.ts` uses a shared boot promise so that
  concurrent cold-start requests wait for the same initialisation rather than launching
  duplicate boot sequences. Seed-data failures are treated as non-fatal, and the broker shim
  is validated after bootstrap with automatic reattachment if lost.
- **Broker-resilient metadata handler** — `HttpDispatcher.handleMetadata()` no longer requires
  a broker upfront. It tries the protocol service and ObjectQL registry first, falling back to
  the broker only when available. Serverless/lightweight setups without a full message broker
  now return proper metadata responses instead of throwing 500 errors.

### Added
- **`@objectstack/service-analytics`** — New multi-driver analytics service implementing `IAnalyticsService`.
  Uses a **Strategy Pattern** with priority-ordered chain: **P1 NativeSQLStrategy** (pushes queries as
  native SQL to Postgres/MySQL drivers), **P2 ObjectQLStrategy** (translates to ObjectQL `aggregate()` AST),
  **P3 InMemoryStrategy** (delegates to existing `MemoryAnalyticsService` for dev/test). Includes
  `CubeRegistry` for auto-discovery of cubes from manifest definitions and object schema inference,
  `AnalyticsServicePlugin` for kernel plugin lifecycle, `generateSql()` dry-run capability, and
  `queryCapabilities()` driver probing for dynamic strategy selection. 34 unit tests covering all
  strategy branches.
- **Studio system objects visibility** — Studio now auto-registers all system objects (sys_user,
  sys_role, sys_audit_log, etc.) from plugin-auth, plugin-security, and plugin-audit at kernel
  initialization. The sidebar "System" group dynamically lists all `isSystem=true` objects
  with a collapsible "System Objects" section. A filter toggle on the Data group allows
  showing/hiding system objects from the main object list.
- **ObjectSchema `namespace` property** — New optional `namespace` field on `ObjectSchema` for logical domain
  classification (e.g., `'sys'`, `'crm'`). When set, `tableName` is auto-derived as `{namespace}_{name}` by
  `ObjectSchema.create()` unless an explicit `tableName` is provided. This decouples the logical object name
  from the physical table name and enables unified routing, permissions, and discovery by domain.
- **SystemObjectName constants** — Extended with all system objects: `ORGANIZATION`, `MEMBER`, `INVITATION`,
  `TEAM`, `TEAM_MEMBER`, `API_KEY`, `TWO_FACTOR`, `ROLE`, `PERMISSION_SET`, `AUDIT_LOG` (in addition to
  existing `USER`, `SESSION`, `ACCOUNT`, `VERIFICATION`, `METADATA`).
- **plugin-auth system objects** — Added `SysOrganization`, `SysMember`, `SysInvitation`, `SysTeam`,
  `SysTeamMember`, `SysApiKey`, `SysTwoFactor` object definitions with `namespace: 'sys'`. Existing objects
  (`SysUser`, `SysSession`, `SysAccount`, `SysVerification`) migrated to use namespace convention.
- **plugin-security system objects** — Added `SysRole` and `SysPermissionSet` object definitions.
- **plugin-audit** — New plugin package with `SysAuditLog` immutable audit trail object definition.
- **StorageNameMapping.resolveTableName()** — Now supports namespace-aware auto-derivation
  (`{namespace}_{name}` fallback when no explicit `tableName` is set).

### Changed
- **ObjectFilterSchema `includeSystem` default** — Changed from `false` to `true`. Studio
  ObjectManager now includes system objects by default. Users can toggle visibility via the
  Data group filter control.
- **System object naming convention** — All system objects now use `namespace: 'sys'` with short `name`
  (e.g., `name: 'user'` instead of `name: 'sys_user'`). The `sys_` prefix is auto-derived via
  `tableName` = `{namespace}_{name}`. File naming follows `sys-{name}.object.ts` pattern.
- **plugin-auth object exports** — New canonical exports use `Sys*` prefix (e.g., `SysUser`, `SysSession`).
  Legacy `Auth*` exports are preserved as deprecated re-exports for backward compatibility.
- **sys_metadata object** — Migrated to `namespace: 'sys'`, `name: 'metadata'` convention (tableName
  auto-derived as `sys_metadata`).
- **Locale code fallback** — New `resolveLocale()` helper in `@objectstack/core` that resolves
  locale codes through a 4-step fallback chain: exact match → case-insensitive match
  (`zh-cn` → `zh-CN`) → base language match (`zh-CN` → `zh`) → variant expansion
  (`zh` → `zh-CN`). Used by `createMemoryI18n`, `HttpDispatcher.handleI18n()`, and
  `I18nServicePlugin` route handlers.
- **Auto-detection of I18nServicePlugin** — Both `DevPlugin` and CLI `serve` command now
  automatically detect `translations`/`i18n` config in the stack definition and register
  `I18nServicePlugin` from `@objectstack/service-i18n` when available. Falls back to
  the core in-memory i18n (with locale resolution) if the package is not installed.
- **Enhanced i18n diagnostics** — `AppPlugin` now emits clear warnings when:
  - Translations exist but no i18n service is registered (guides user to add the plugin).
  - Translations are loaded into a fallback/stub i18n service (recommends production plugin).
- **i18n locale fallback in REST routes** — `HttpDispatcher.handleI18n()` translations and labels
  endpoints now resolve locale codes via fallback when exact match returns empty translations.
  The response includes `requestedLocale` when a fallback was used.

### Changed
- **DevPlugin i18n stub** — Replaced the duplicate `createI18nStub()` in `DevPlugin` with
  `createMemoryI18n` from `@objectstack/core`, ensuring locale fallback works consistently
  in dev mode. DevPlugin now tries `I18nServicePlugin` before the stub when stack has translations.
- `createMemoryI18n` now uses `resolveLocale()` internally for `t()` and `getTranslations()`,
  enabling locale fallback (e.g. `zh` → `zh-CN`) without any plugin changes.
- CLI `serve` command now auto-registers `I18nServicePlugin` when config has translations/i18n,
  mirroring DevPlugin's auto-detection behavior for production environments.

### Changed
- **i18n route self-registration** — Moved i18n REST endpoint registration from `RestServer` to
  `I18nServicePlugin` (and kernel fallback). The i18n plugin now self-registers `/api/v1/i18n/*`
  routes via the `kernel:ready` hook, following the same autonomous plugin pattern used by
  `AuthPlugin`, `WorkflowPlugin`, and other service plugins. `RestServer` no longer registers or
  manages any i18n endpoints, keeping it strictly a protocol-driven gateway.
- Removed `enableI18n` flag from `RestApiConfig` schema (`rest-server.zod.ts`) — i18n endpoints
  are now controlled by the i18n service plugin's own `registerRoutes` option (default: `true`).
- Removed `registerI18nEndpoints()` method from `RestServer` class.
- `I18nServicePlugin` now accepts `registerRoutes` and `basePath` options for HTTP route control.
- i18n endpoints now work independently of `RestServer`, enabling MSW/mock test environments
  to serve i18n routes without any REST API gateway dependency.
- **Dispatcher i18n bridge routes** — `createDispatcherPlugin()` now registers i18n HTTP route
  bridges (`GET /i18n/locales`, `GET /i18n/translations/:locale`, `GET /i18n/labels/:object/:locale`)
  via `HttpDispatcher.handleI18n()`, ensuring i18n endpoints work even when only the kernel's
  memory fallback i18n is active (no explicit `I18nServicePlugin` loaded). This is consistent with
  how auth, analytics, packages, storage, and automation services are bridged.

### Added
- **i18n as core built-in service** — The i18n service is now a `core` criticality service with
  automatic in-memory fallback. When no plugin (e.g. `I18nServicePlugin`) registers an i18n service,
  the kernel auto-injects `createMemoryI18n` (in-memory Map-backed II18nService implementation)
  during `validateSystemRequirements()`. This ensures `/api/v1/i18n/*` routes and discovery always
  report i18n as available, even without `plugin-i18n` installed.
- `createMemoryI18n` fallback factory in `@objectstack/core` (packages/core/src/fallbacks/memory-i18n.ts)
  implementing `II18nService` contract with translation loading, dot-notation key resolution, parameter
  interpolation, and locale management.

### Changed
- `ServiceRequirementDef.i18n` upgraded from `'optional'` to `'core'` — kernel now warns (instead
  of silently ignoring) when no i18n service is registered, and auto-injects in-memory fallback.
- `SERVICE_CONFIG['i18n'].plugin` in `protocol.ts` corrected from `'plugin-i18n'` to `'service-i18n'`
  to match the actual `@objectstack/service-i18n` package name.
- Updated kernel-services.mdx documentation to reflect i18n as core/built-in capability.

### Fixed
- **AppPlugin getService crash on missing services** — `AppPlugin.start()` and
  `loadTranslations()` now wrap `ctx.getService()` in try/catch, since the kernel's
  `getService` throws when a service is not registered (rather than returning `undefined`).
  This was the direct cause of `plugin.app.com.example.crm failed to start` — the i18n
  service was not registered, so `getService('i18n')` threw an unhandled exception.
- **CLI serve: host config AppPlugin mis-wrap** — `serve.ts` no longer wraps a host/aggregator config
  (one that already contains instantiated plugins in its `plugins` array) with an extra `AppPlugin`.
  This prevents the `plugin.app.dev-workspace failed to start` error and eliminates duplicate plugin
  registration when running `pnpm dev`.
- **plugin-auth CJS→ESM interop** — Added `module` and `exports` fields to
  `@objectstack/plugin-auth` package.json so Node.js resolves the ESM build (`.mjs`) when using
  dynamic `import()`, eliminating the `ExperimentalWarning: CommonJS module … is loading ES Module`
  warning caused by `better-auth` being ESM-only.
- **i18n service registration & state inconsistency** — Discovery API (`getDiscoveryInfo`) now uses
  the same async `resolveService()` fallback chain that request handlers (`handleI18n`) use, ensuring
  the reported service status is always consistent with actual runtime availability.
- Discovery `locale` field is now populated from the actual i18n service (`getDefaultLocale`,
  `getLocales`) instead of being hardcoded, so clients get accurate locale information.
- Updated all framework adapters (Hono, Express, Fastify, Next.js, NestJS, Nuxt, SvelteKit),
  the dispatcher plugin, and the MSW plugin to `await` the now-async `getDiscoveryInfo()`.

### Added
- **AppPlugin i18n auto-loading** — `AppPlugin` now automatically loads translation bundles from
  app configs (`translations` array) into the kernel's i18n service during the `start` phase,
  coordinating i18n data loading across server/dev/mock environments.
- i18n service registration guide in `content/docs/guides/kernel-services.mdx` documenting
  service registration patterns, discovery consistency, and AppPlugin auto-loading behavior.

### Changed
- Updated ROADMAP.md for v3.0 release preparation with full codebase scan results
- Audited all @deprecated items: 14 in spec, 9 in runtime packages (23 total)
- Identified stale deprecation notices targeting v2.0.0 (current: v2.0.7)
- Updated metrics: 172 schema files, 191 test files, 5,165 tests, 7,095 .describe() annotations

### Deprecated
- The following items are scheduled for removal in v3.0.0 (see `packages/spec/V3_MIGRATION_GUIDE.md`):
  - `Hub.*` barrel re-exports from `hub/index.ts`
  - `location` (singular) on `ActionSchema` — use `locations` (array)
  - `definePlugin()` in spec — will move to `@objectstack/core`
  - `createErrorResponse()` / `getHttpStatusForCategory()` in spec — will move to `@objectstack/core`
  - `RateLimitSchema`, `RealtimePresenceStatus`, `RealtimeAction` aliases
  - Event bus helper functions (`createDefaultEventBusConfig`, `createDefaultDLQConfig`, `createDefaultEventHandlerConfig`)
  - `HttpDispatcher` class in `@objectstack/runtime`
  - `createHonoApp()` in `@objectstack/hono`

## [2.0.7] - 2026-02-11

### Added
- Modularized `kernel/events.zod.ts` (765 lines) into 6 focused sub-modules for better tree-shaking:
  - `events/core.zod.ts`: Priority, metadata, type definition, base event
  - `events/handlers.zod.ts`: Event handlers, routes, persistence
  - `events/queue.zod.ts`: Queue config, replay, sourcing
  - `events/dlq.zod.ts`: Dead letter queue, event log entries
  - `events/integrations.zod.ts`: Webhooks, message queues, notifications
  - `events/bus.zod.ts`: Complete event bus config and helpers
- Created v3.0 migration guide (`packages/spec/V3_MIGRATION_GUIDE.md`)

### Changed
- `kernel/events.zod.ts` now re-exports from sub-modules (backward compatible)
- Updated all packages to version 2.0.7 with unified versioning

## [2.0.6] - 2026-02-11

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 2.0.6 with unified versioning

## [2.0.5] - 2026-02-10

### Changed
- Unified all package versions to 2.0.5
- Added `@objectstack/plugin-auth` and `@objectstack/plugin-security` to the changeset fixed versioning group
- All packages now release together under the same version number

## [2.0.4] - 2026-02-10

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 2.0.4 with unified versioning

## [2.0.3] - 2026-02-10

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 2.0.3 with unified versioning

## [2.0.2] - 2026-02-10

### Changed
- Exclude generated JSON schema files from git tracking
- Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
- JSON schema files are still generated during `pnpm build` and included in npm publish
- Fix studio module resolution logic for better compatibility
- Updated all packages to version 2.0.2 with unified versioning

## [2.0.1] - 2026-02-09

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 2.0.1 with unified versioning

## [0.9.1] - 2026-02-03

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 0.9.1 with unified versioning

## [0.9.0] - 2026-02-03

### Changed
- Minor version bump for new features and improvements
- All packages updated to version 0.9.0

## [0.8.2] - 2026-02-02

### Changed
- **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`
- **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface
- **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`
- Updated `@objectstack/plugin-msw` to dynamically load `@objectstack/objectql` to avoid hard dependencies

## [0.8.1] - 2026-02-01

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 0.8.1

## [0.8.0] - 2026-02-01

### Changed
- Upgrade to Zod v4 and protocol improvements
- Aligned all protocol definitions with stricter type safety
- Updated all packages to version 0.8.0

## [0.7.2] - 2026-01-31

### Changed
- Updated system protocol JSON schemas (events, worker, metadata-loader)
- Enhanced documentation structure for system protocols
- Generated comprehensive JSON schema documentation

## [0.7.1] - 2026-01-31

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 0.7.1

## [0.6.1] - 2026-01-28

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 0.6.1

## [0.4.1] - 2026-01-27

### Fixed
- Synchronized plugin-msw version to 0.4.1 (was incorrectly at 0.3.3)
- Updated runtime peer dependency versions to ^0.4.1 across all plugins
- Fixed internal dependency version mismatches

## [0.4.0] - 2026-01-26

### Changed
- Updated all core packages to version 0.4.0

## [0.3.3] - 2026-01-25

### Changed
- Enhanced GitHub workflows for CI, release, and PR automation
- Added comprehensive prompt templates for different protocol areas
- Improved project documentation and automation guides
- Updated changeset configuration
- Added cursor rules for better development experience
- Updated all packages to version 0.3.3

## [0.3.2] - 2026-01-24

### Changed
- Patch release for maintenance and stability improvements
- Updated all packages to version 0.3.2

## [0.3.1] - 2026-01-23

### Changed
- Organized zod schema files by folder structure
- Improved project documentation

## [0.3.0] - 2026-01-22

### Added
- Comprehensive documentation structure with CONTRIBUTING.md
- Documentation hub at docs/README.md
- Standards documentation (naming-conventions, api-design, error-handling)
- Architecture deep dives (data-layer, ui-layer, system-layer)
- Code of Conduct
- Changelog template
- Migration guides structure
- Security and performance guides

### Changed
- Updated README.md with improved documentation navigation
- Enhanced documentation organization following industry best practices
- All packages now use unified versioning (all packages released together with same version number)

## [0.1.1] - 2026-01-20

### Added
- Initial protocol specifications
- Zod schemas for data, UI, system, AI, and API protocols
- JSON schema generation
- Basic documentation site with Fumadocs
- Example implementations (CRM, Todo)

## Template for Future Releases

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features or capabilities

### Changed
- Changes to existing functionality

### Deprecated
- Features that will be removed in upcoming releases

### Removed
- Features that have been removed

### Fixed
- Bug fixes

### Security
- Security-related changes
```

## How to Use This Changelog

### For Contributors

When making changes:

1. **Add entries under `[Unreleased]`** section
2. **Choose the appropriate category**: Added, Changed, Deprecated, Removed, Fixed, Security
3. **Write clear, concise descriptions** of your changes
4. **Link to PRs or issues** where applicable: `- Feature description (#PR_NUMBER)`

Example:
```markdown
### Added
- New encrypted field type for sensitive data (#123)
- Support for PostgreSQL window functions in query protocol (#124)

### Fixed
- Validation error when using lookup fields with filters (#125)
```

### For Maintainers

When releasing a new version:

1. **Create a new version section** from the `[Unreleased]` content
2. **Move entries** from `[Unreleased]` to the new version section
3. **Add release date** in YYYY-MM-DD format
4. **Tag the release** in git: `git tag -a v0.2.0 -m "Release v0.2.0"`
5. **Update links** at the bottom of the file

### Versioning Guide

Following [Semantic Versioning](https://semver.org/):

- **MAJOR** version (X.0.0): Incompatible API changes
- **MINOR** version (0.X.0): Add functionality in a backward compatible manner
- **PATCH** version (0.0.X): Backward compatible bug fixes

### Categories

- **Added**: New features, protocols, schemas, or capabilities
- **Changed**: Changes to existing functionality
- **Deprecated**: Features marked for removal (but still working)
- **Removed**: Features that have been removed
- **Fixed**: Bug fixes
- **Security**: Security vulnerability fixes or improvements

### Breaking Changes

Mark breaking changes clearly:

```markdown
### Changed
- **BREAKING**: Renamed `maxLength` to `maxLen` in FieldSchema (#126)
  Migration: Update all field definitions to use `maxLen` instead of `maxLength`
```

## Release Process

1. Update CHANGELOG.md with release notes
2. Update version in package.json files
3. Run `pnpm changeset version` to update package versions
4. Commit changes: `git commit -m "chore: release vX.Y.Z"`
5. Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
6. Push: `git push && git push --tags`
7. Run `pnpm release` to publish packages

---

[Unreleased]: https://github.com/objectstack-ai/spec/compare/v2.0.7...HEAD
[2.0.7]: https://github.com/objectstack-ai/spec/compare/v2.0.6...v2.0.7
[2.0.6]: https://github.com/objectstack-ai/spec/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/objectstack-ai/spec/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/objectstack-ai/spec/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/objectstack-ai/spec/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/objectstack-ai/spec/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/objectstack-ai/spec/compare/v0.9.1...v2.0.1
[0.9.1]: https://github.com/objectstack-ai/spec/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/objectstack-ai/spec/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/objectstack-ai/spec/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/objectstack-ai/spec/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/objectstack-ai/spec/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/objectstack-ai/spec/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/objectstack-ai/spec/compare/v0.6.1...v0.7.1
[0.6.1]: https://github.com/objectstack-ai/spec/compare/v0.4.1...v0.6.1
[0.4.1]: https://github.com/objectstack-ai/spec/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/objectstack-ai/spec/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/objectstack-ai/spec/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/objectstack-ai/spec/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/objectstack-ai/spec/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/objectstack-ai/spec/compare/v0.1.1...v0.3.0
[0.1.1]: https://github.com/objectstack-ai/spec/releases/tag/v0.1.1
