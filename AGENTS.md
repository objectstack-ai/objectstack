# ObjectStack — AGENTS.md

Primary AI instruction file for this repo. Mirrored at `.github/copilot-instructions.md` — keep both in sync.

> **v5.0 breaking rename: `project` → `environment`.** The per-tenant business workspace (Org/Environment/Branch) is now `environment` everywhere: CLI (`--environment`/`-e`), HTTP (`/api/v1/environments/:environmentId/...`), header `X-Environment-Id`, env `OS_ENVIRONMENT_ID`, exports (`createSystemEnvironmentPlugin`, `SYSTEM_ENVIRONMENT_ID`), DB column `environment_id`, JSON `EnvironmentArtifact`. No aliases, no shims. See `.changeset/v5-project-to-environment-rename.md` and ADR-0006. "Project" only refers to the npm/monorepo sense.

---

## Build & Test

```bash
pnpm install          # deps
pnpm setup            # first-time: install + build spec
pnpm build            # turbo build (excludes docs)
pnpm test             # turbo test
pnpm docs:dev         # docs site
```

### Running the dev server

Two distinct scenarios — pick the right one:

| Scenario | Command | Port | State | Cleanup |
|:---|:---|:---|:---|:---|
| **Frontend debugging** (UI in `../objectui` calls backend) | `PORT=3000 pnpm dev:crm` | **Must be 3000** — UI is hard-wired | Persistent (`<cwd>/.objectstack/`) | Leave running |
| **Backend-only debugging** (API/protocols, no UI) | `pnpm dev:crm -- --fresh -p <random>` | Random high port (e.g. 38421) | **Ephemeral** tempdir, auto-seeded admin | **You must kill it** (`kill <PID>` via `lsof -ti tcp:<port>`) |

`--fresh` (added in `os dev`):
- Creates a unique tempdir under the OS tempdir and points `OS_HOME` + `OS_DATABASE_URL` + `OS_STORAGE_ROOT` into it.
- Auto-deletes the tempdir on normal exit.
- Implies `--seed-admin` — after the server is ready, POSTs to `/api/v1/auth/sign-up/email` and prints the credentials:
  - default email: `admin@dev.local`
  - default password: `admin12345`
  - override with `--admin-email` / `--admin-password`; opt out with `--no-seed-admin`.

Rules:
- **Never start two backends on port 3000 simultaneously** — it collides with the UI dev session.
- For backend-only tasks, always pick a random high port AND tear it down after the task — don't leak processes.
- Use `pnpm dev:crm` (not raw `pnpm --filter ... dev`) so the example app is configured correctly. Flags after `--` are forwarded.

Example (backend-only debugging session, clean environment):
```bash
pnpm dev:crm -- --fresh -p 38421       # start
# ... debug via curl, http://localhost:38421 ...
kill $(lsof -ti tcp:38421)              # tear down — tempdir auto-deletes
```

### Frontend (Studio UI) — sibling repo `../objectui`

This framework repo ships **backend only** (protocols + services + REST). All Studio / Console UI work happens in the sibling repo `../objectui` (separate git repo, separate versions).

**Local dev workflow** (this is the assumed environment — `../objectui` is checked out next to `framework/`):

1. `cd ../objectui` — make UI changes there.
2. Commit & push in `../objectui` (the refresh script pulls from its git state).
3. Back in `framework/`, run:
   ```bash
   pnpm objectui:refresh    # = bump-objectui.sh + build-console.sh
   ```
   This pulls the latest `../objectui` build into `packages/console/` so the backend serves the updated UI.

Related scripts: `pnpm objectui:bump` (pull only), `pnpm objectui:build` (rebuild console), `pnpm objectui:clean` (wipe cache).

⚠️ Never hand-edit files under `packages/console/dist/` or `.cache/objectui-*/` — they are regenerated.

---

## Prime Directives

1. **Zod First.** All schemas start as Zod. Types via `z.infer<typeof X>`. JSON Schemas generated from Zod.
2. **No business logic in `packages/spec`.** Spec = schemas/types/constants only. Runtime logic goes in `core`, `runtime`, or `services/*`.
3. **Naming:**
   - TS config keys → `camelCase` (`maxLength`, `defaultValue`)
   - Machine names (data values) → `snake_case` (`name: 'first_name'`)
   - Metadata type names → **singular** (`'agent'`, `'view'`, `'flow'`) — matches `MetadataTypeSchema` in `packages/spec/src/kernel/metadata-plugin.zod.ts`
   - REST endpoints → plural (`/api/v1/ai/agents`)
4. **Imports:** Use `@objectstack/spec` namespaces or subpaths. Never relative `../../packages/spec`.
5. **No workarounds.** Adopt sustainable, well-architected solutions — not temporary patches.
6. **Object name = table name.** The object `name` is the canonical id everywhere (API, ObjectQL, REST, SDK, DB table). **Never** set `namespace` (deprecated) or `tableName` (always equals `name`). For module prefixes, embed in the name (`sys_user`, `ai_conversations`).
7. **One Zod source per metadata type.** Each type (`view`, `flow`, `agent`, …) has exactly one schema in `packages/spec/src/{domain}/`. Org overlay opt-in lives only in `allowOrgOverride` on `DEFAULT_METADATA_TYPE_REGISTRY` — no parallel whitelists. See ADR-0005.
8. **North Star alignment.** Read `content/docs/concepts/north-star.mdx` before structural changes. If a change doesn't advance §7 Built, shrink Drift, or unlock Missing — it probably shouldn't ship.
9. **`OS_` env-var prefix.** All ObjectStack-owned environment variables MUST start with `OS_`. When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW_NAME', 'LEGACY_NAME')` from `@objectstack/types` so the legacy name still works for one release with a one-shot deprecation warning. Documented third-party exceptions (NOT renamed): `PORT`, `DATABASE_URL`, `NODE_ENV`, `OPENAI_API_KEY`, `TURSO_*`, `BETTER_AUTH_URL`, OAuth `*_CLIENT_ID` / `*_CLIENT_SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`. See issue #1382.

---

## Monorepo Layout

```
packages/
  spec/           # 🏛️ Protocol schemas, types, constants (Zod source of truth)
  core/           # ⚙️ ObjectKernel, DI, EventBus
  types/          # 📦 Shared TS utilities
  metadata/       # 📋 Metadata loading & persistence
  objectql/       # 🔍 Query engine
  runtime/        # 🏃 Bootstrap (Driver/App plugins)
  rest/           # 🌐 Auto-generated REST layer
  client/         # 📡 Framework-agnostic SDK
  client-react/   # ⚛️ React hooks
  cli/            # 🖥️ CLI
  create-objectstack/  # 🚀 Scaffolding
  vscode-objectstack/  # 🧩 VS Code extension
  adapters/       # 🔌 express/fastify/hono/nestjs/nextjs/nuxt/sveltekit
  plugins/        # 🧱 Official plugins & drivers
  services/       # 🔧 Kernel-managed services
apps/docs/        # 📖 Fumadocs site
examples/         # 📚 Reference implementations
skills/           # 🤖 Domain skill definitions
content/docs/     # 📝 Docs content
```

Studio UI: `../objectui` (sibling repo).

---

## Protocol Domains (`packages/spec/src/`)

| Namespace | Path | Responsibility |
|:---|:---|:---|
| `Data` | `data/` | Object, Field, FieldType, Query, Filter, Sort |
| `UI` | `ui/` | App, View (grid/kanban/calendar/gantt), Dashboard, Report, Action |
| `System` | `system/` | Manifest, Datasource, API endpoints, Translation (i18n) |
| `Automation` | `automation/` | Flow, Workflow, Trigger registry |
| `AI` | `ai/` | Agent, Tool, Skill, RAG, Model registry |
| `API` | `api/` | REST/GraphQL contract, Endpoint, Realtime |
| `Identity` | `identity/` | User, Organization, Profile |
| `Security` | `security/` | Permission, Role, Policy |
| `Kernel` | `kernel/` | Plugin lifecycle (PluginContext) |
| `Cloud` | `cloud/` | Multi-tenant, deployment, environment |
| `QA` | `qa/` | Test, validation |
| `Contracts` | `contracts/` | Cross-package interfaces |
| `Integration` | `integration/` | External integrations |
| `Studio` | `studio/` | Studio UI metadata |
| `Shared` | `shared/` | Error maps, normalization utilities |

Root also exports: `defineStack`, `composeStacks`, `defineView`, `defineApp`, `defineFlow`, `defineAgent`, `defineTool`, `defineSkill`.

---

## Kernel

| Kernel | Use For |
|:---|:---|
| `ObjectKernel` | Default production runtime. Full DI / EventBus / Plugin lifecycle. |
| `LiteKernel` | Tests (vitest), serverless, edge (Workers). |

`EnhancedObjectKernel` is deprecated — do not use.

---

## Documentation Guardrails

| Path | Type | Rule |
|:---|:---|:---|
| `content/docs/references/` | **AUTO-GEN** | ❌ Never hand-edit. Regenerated by `packages/spec/scripts/build-docs.ts`. |
| `content/docs/guides/` | hand-written | ✅ Update `meta.json` when adding pages. |
| `content/docs/concepts/` | hand-written | ✅ |
| `content/docs/getting-started/` | hand-written | ✅ |
| `content/docs/protocol/` | hand-written | ✅ |

---

## Context Routing — apply the right role per path

| Path | Role | Key Constraints |
|:---|:---|:---|
| `**/objectstack.config.ts` | Project Architect | `defineStack`, driver/adapter selection |
| `packages/spec/src/data/**` | Data Architect | Zod-first, snake_case, TSDoc every prop |
| `packages/spec/src/ui/**` | UI Protocol Designer | View types, SDUI patterns |
| `packages/spec/src/automation/**` | Automation Architect | Flow/Workflow state machines |
| `packages/spec/src/ai/**` | AI Protocol Designer | Agent/Tool/Skill schemas |
| `packages/spec/src/system/**` | System Architect | Manifest, datasource, i18n |
| `packages/spec/src/kernel/**` | Kernel Engineer | Plugin lifecycle, PluginContext |
| `packages/spec/src/security/**` | Security Architect | RBAC, policies |
| `packages/core/**` | Kernel Engineer | Runtime logic OK here |
| `packages/runtime/**` | Runtime Engineer | Bootstrap, plugin registration |
| `packages/rest/**` | API Engineer | Route gen, middleware |
| `packages/plugins/**` | Plugin Developer | Implements spec contracts |
| `packages/services/**` | Service Engineer | Kernel-managed services |
| `packages/adapters/**` | Integration Engineer | Framework bindings, zero business logic |
| `packages/client*/**` | SDK Engineer | Public API, DX, type safety |
| `apps/docs/**` | Docs Engineer | Fumadocs + Next.js, MDX |
| `examples/**` | Example Author | Minimal, runnable, uses `defineStack` |
| `content/docs/**` | Technical Writer | Respect auto-gen boundaries |
| `../objectui/**` (sibling repo) | Studio UI Engineer | React + Shadcn + Tailwind, dark mode default |

---

## Skills (`skills/`)

Consult the matching `SKILL.md` when working in its domain: `objectstack-platform`, `objectstack-data`, `objectstack-query`, `objectstack-api`, `objectstack-ui`, `objectstack-automation`, `objectstack-ai`, `objectstack-i18n`, `objectstack-formula` (CEL).

---

## Patterns

**Zod schema:**
```ts
export const FieldSchema = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name (snake_case)'),
  label: z.string().describe('Display label'),
  type: FieldTypeSchema,
  maxLength: z.number().optional(),
  defaultValue: z.any().optional(),
});
export type Field = z.infer<typeof FieldSchema>;
```

**Plugin:**
```ts
export default {
  async onInstall(ctx: PluginContext) { /* migrations */ },
  async onEnable(ctx: PluginContext)  { /* register routes/services */ },
  async onDisable(ctx: PluginContext) { /* cleanup */ },
};
```

---

## Post-Task Checklist

1. `pnpm test` — verify nothing broke.
2. Update `CHANGELOG.md` / `ROADMAP.md` if user-facing or architectural.
3. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
