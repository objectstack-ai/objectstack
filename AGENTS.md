# ObjectStack — AGENTS.md

Primary AI instruction file for this repo. Read natively by Claude Code, GitHub Copilot (coding agent + CLI, since Aug 2025), and other agents — no separate `.github/copilot-instructions.md` mirror needed.

> **v5.0 breaking rename: `project` → `environment`** everywhere (CLI `-e`, `/api/v1/environments/:id`, header `X-Environment-Id`, `OS_ENVIRONMENT_ID`, DB column `environment_id`). No aliases. See ADR-0006. "Project" now only means the npm/monorepo sense.

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

| Scenario | Command | Notes |
|:---|:---|:---|
| **Frontend debug** (UI in `../objectui` calls backend) | `PORT=3000 pnpm dev` | `pnpm dev` = the **showcase** kitchen-sink app (default; best for exercising the platform). Port **must** be 3000 (UI hard-wired); persistent state; leave running. For the minimal CRM app instead: `PORT=3000 pnpm dev:crm`. |
| **Backend-only debug** | `pnpm dev -- --fresh -p <random>` | Random high port; ephemeral tempdir; **you must kill it** when done |

`--fresh`: ephemeral tempdir (auto-deleted on exit) + `--seed-admin` (POSTs sign-up, prints creds — default `admin@objectos.ai` / `admin123`, override via `--admin-email`/`--admin-password`). The seeded admin is auto-promoted to **platform admin** (the system seed identity `usr_system` is skipped), so Setup/Studio are reachable on first login.

Rules: never run two backends on port 3000; for backend tasks pick a random port and tear it down; always use a `pnpm dev`/`dev:crm`/`dev:showcase` script (flags after `--` are forwarded), not raw `pnpm --filter`.

```bash
pnpm dev:crm -- --fresh -p 38421   # start; debug via curl
kill $(lsof -ti tcp:38421)         # tear down — tempdir auto-deletes
```

### Frontend (Studio UI) — sibling repo `../objectui`

This repo ships **backend only**. All Studio/Console UI work happens in `../objectui` (separate repo, checked out next to `framework/`). Workflow: edit + commit + push in `../objectui`, then in `framework/` run `pnpm objectui:refresh` to pull its build into `packages/console/`.

Other scripts: `objectui:bump` (pull only), `objectui:build`, `objectui:clean`. ⚠️ Never hand-edit `packages/console/dist/` or `.cache/objectui-*/` — regenerated.

**Fast iteration on `../objectui` src (no commit/refresh loop):** run objectui's own console dev server — `cd ../objectui && pnpm --filter @object-ui/console dev` (Vite on **:5180**, HMR). Its `/api` proxy targets `DEV_PROXY_TARGET || http://localhost:3000`, so **run the backend you're testing on :3000** (`PORT=3000 pnpm dev` for showcase) and browse `:5180`. Note `:3001/_console` (or whatever the backend serves) is the **published** console, not your `../objectui` src — only `:5180` reflects local UI edits. See `../objectui/AGENTS.md` for the app-id / localStorage / auth gotchas.

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
9. **`OS_` env-var prefix.** All ObjectStack-owned env vars MUST start with `OS_`. When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW', 'LEGACY')` from `@objectstack/types` (keeps legacy working one release). Third-party exceptions kept as-is: `NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`, `SMTP_*`. See #1382.
10. **File issues for out-of-scope findings — don't silently expand scope or leave them buried.** When you hit a bug, gap, or unenforced capability that's unrelated to the current task, or too large to fix in scope, open a GitHub issue (`gh issue create`) with a clear repro/decision and link it from your PR. Corollary: **never advertise or demo a capability the runtime doesn't actually deliver** (declared ≠ enforced) — fix it, trim it, or file an issue, but don't fake coverage. Example: the spec declares 9 validation-rule types but the write-path validator enforces only 3 (`state_machine`/`script`/`cross_field`); the other 6 are tracked in #1475 rather than demoed in the showcase.

---

## Multi-agent working discipline

This repo is worked on by **multiple agents in parallel**. Prefer **one git
worktree per agent/task** (`git worktree add ../framework-<task> -b <branch>`;
run `pnpm install` in the new tree) so file systems are physically isolated —
that avoids most of the contention below. When agents must share one working
tree, branches get switched and shared files change *under you* mid-task — this
is expected, not a bug. Operate defensively:

1. **Only touch the files your task needs.** Don't "fix" unrelated diffs,
   reverts, or other agents' in-flight edits, and don't try to manage the whole
   working tree. If a file you didn't change shows as modified, leave it.
2. **One feature branch + one PR per task.** Branch off `main`. **Never commit
   task work straight to `main`.**
3. **Never `git push --force` / `--force-with-lease`, and never push `main`.** A
   force-push can clobber a parallel agent's work; `main` is shared — land
   everything via PR.
4. **Verify the current branch before every commit/push**
   (`git rev-parse --abbrev-ref HEAD`). HEAD may have been switched by another
   agent — if it isn't your feature branch, stop and re-checkout before pushing.
5. **Shared files (barrels/registries like `builtin/index.ts`): edit → `git add`
   → commit atomically, then confirm the commit really contains your lines**
   (`git show HEAD:<file> | grep <yourChange>`). A concurrent edit can revert
   your working-tree change between the edit and the commit. On a real conflict,
   re-apply only *your* lines and let the PR merge integrate the rest.
6. **Don't rebase or force-update shared branches** to tidy other agents' commits.
7. **Merge only after remote CI is fully green. Never `gh pr merge --auto`.**
   Auto-merge can land a still-red PR onto shared `main` and break it for every
   parallel agent (see #1475). Merge serially; rebase other open branches before
   merging the next one.

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
2. **Add a changeset for feature work.** When the change is a feature or functional improvement, run `pnpm changeset` (or add a `.changeset/*.md` entry) describing it before committing. Pure bug fixes do **not** require a changeset.
3. Update `CHANGELOG.md` / `ROADMAP.md` if user-facing or architectural.
4. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
