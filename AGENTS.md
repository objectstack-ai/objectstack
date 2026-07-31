# ObjectStack — AGENTS.md

Primary AI instruction file for this repo. Read natively by Claude Code, GitHub Copilot (coding agent + CLI, since Aug 2025), and other agents — no separate `.github/copilot-instructions.md` mirror needed.

> **v5.0 breaking rename: `project` → `environment`** everywhere (CLI `-e`, `/api/v1/environments/:id`, header `X-Environment-Id`, `OS_ENVIRONMENT_ID`, DB column `environment_id`). No aliases. See ADR-0006. "Project" now only means the npm/monorepo sense.

---

## Communication

- **与维护者沟通时一律使用中文**(对话回复、PR/issue 讨论中的解释性文字)。
- 代码、标识符、提交信息(commit messages)、ADR/文档正文等仓库产物保持现有语言惯例(以英文为主),不要因本条而改写。

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

Rules: never run two backends on port 3000; for backend tasks pick a random port and tear it down; **never kill a server you didn't start** (other agents/the user may be using it — see Multi-agent discipline §8); always use a `pnpm dev`/`dev:crm`/`dev:showcase` script (flags after `--` are forwarded), not raw `pnpm --filter`.

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
   - Error codes → `SCREAMING_SNAKE` (`PERMISSION_DENIED`) — machine constants, not data values; scope and rationale in [ADR-0112](./docs/adr/0112-error-code-vocabulary-and-ledger.md). Not a general license to deviate.
   - Metadata type names → **singular** (`'agent'`, `'view'`, `'flow'`) — matches `MetadataTypeSchema` in `packages/spec/src/kernel/metadata-plugin.zod.ts`
   - REST endpoints → plural (`/api/v1/ai/agents`)
4. **Imports:** Use `@objectstack/spec` namespaces or subpaths. Never relative `../../packages/spec`.
5. **No workarounds.** Adopt sustainable, well-architected solutions — not temporary patches.
6. **Object name = table name.** The object `name` is the canonical id everywhere (API, ObjectQL, REST, SDK, DB table). **Never** set `namespace` (deprecated) or `tableName` (always equals `name`). For module prefixes, embed in the name (`sys_user`, `ai_conversations`).
7. **One Zod source per metadata type.** Each type (`view`, `flow`, `agent`, …) has exactly one schema in `packages/spec/src/{domain}/`. Org overlay opt-in lives only in `allowOrgOverride` on `DEFAULT_METADATA_TYPE_REGISTRY` — no parallel whitelists. See ADR-0005.
8. **North Star alignment.** Read `content/docs/concepts/north-star.mdx` before structural changes. If a change doesn't advance §7 Built, shrink Drift, or unlock Missing — it probably shouldn't ship.
9. **`OS_` env-var prefix + structure.** All ObjectStack-owned env vars MUST start with `OS_`, then follow **`OS_{DOMAIN}_{FEATURE}[_QUALIFIER]`** where `DOMAIN` is the subsystem (`AUTH`, `SEARCH`, `CORS`, `CLOUD`, `DATABASE`, `CLUSTER`, `MCP`, `SSO`, …) so related vars group together (cf. `OS_AUTH_*`, `OS_CORS_*`). Pick the shape by what the var *is*:
   - **Boolean feature flag** → suffix **`_ENABLED`**, default-off / opt-in: `OS_{DOMAIN}_{FEATURE}_ENABLED` (`OS_SSO_ENABLED`, `OS_SCIM_ENABLED`, `OS_SEARCH_PINYIN_ENABLED`). Never a bare `OS_PINYIN_SEARCH` — bare names read as config, not toggles.
   - **Config value** (URL / path / secret / level / count) → `OS_{DOMAIN}_{NAME}` (`OS_CLOUD_URL`, `OS_DATABASE_URL`, `OS_LOG_LEVEL`, `OS_AUTH_SECRET`).
   - **Escape hatch / dangerous override** → **`OS_ALLOW_{X}`** — deliberately ungrouped and scary-looking (`OS_ALLOW_MAIN_EDITS`, `OS_ALLOW_MEMORY_CLUSTER_MULTINODE`).
   - **Opt-out** → `OS_SKIP_{X}` / `OS_DISABLE_{X}`. **Test/CI-only** → `OS_TEST_*` / `OS_EXPECT_*`.
   - Pre-existing vars that don't fit (`OS_METADATA_WRITABLE`, `OS_EAGER_SCHEMAS`, `OS_SERVER_TIMING`) are **debt, not precedent** — new vars follow this rule; rename old ones via the deprecation helper below when touched.

   When renaming a legacy var, use `readEnvWithDeprecation('OS_NEW', 'LEGACY')` from `@objectstack/types` (keeps legacy working one release). Third-party exceptions kept as-is: `NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`, `AI_GATEWAY_*`, `SMTP_*`. See #1382.
10. **File issues for out-of-scope findings — don't silently expand scope or leave them buried.** When you hit a bug, gap, or unenforced capability that's unrelated to the current task, or too large to fix in scope, open a GitHub issue (`gh issue create`) with a clear repro/decision and link it from your PR. Corollary: **never advertise or demo a capability the runtime doesn't actually deliver** (declared ≠ enforced) — fix it, trim it, or file an issue, but don't fake coverage. Example: the spec once declared 9 validation-rule types while the write-path validator enforced only 3 (`state_machine`/`script`/`cross_field`); the gap was filed as #1475 rather than demoed in the showcase, then closed by **trimming** what could never be enforced (`unique`/`async`/`custom`) and **implementing** the rest — the spec now declares 6 and `rule-validator.ts` handles all 6. Note how narrow that claim stayed even so: the evaluator was wired into insert and single-id update only, so a bulk `updateMany` silently skipped every rule — a second `declared ≠ enforced` gap one layer down, at the **call site** rather than the `switch`; filed as #3106 and closed by evaluating the bulk match set per row. A `case` label is not enforcement; check the **call site**.
11. **Worktree-first — never edit on the shared `main` checkout.** This repo is edited by **multiple agents at once**; the shared `main` tree has its HEAD switched and reset *under you*, silently clobbering uncommitted work. Before your **first file edit**, you MUST be in a dedicated worktree on a feature branch: `git worktree add ../objectstack-<task> -b <branch> main && cd ../objectstack-<task> && pnpm install`. A PreToolUse hook (`.claude/hooks/guard-main-checkout.sh`) **enforces** this — it blocks `Edit`/`Write`/`NotebookEdit` unless the edited file is in a dedicated **worktree** — a feature branch on the *shared* checkout is **not** enough (it still gets switched under you) — and it checks the **edited file's own repo**, so sibling repos (`objectui`/`cloud`) you touch are covered too (override for a deliberate non-task fix with `OS_ALLOW_MAIN_EDITS=1`). Full playbook below.
12. **Contract-first — fix the metadata, not the runtime.** This is a metadata-driven framework: `packages/spec` is the one contract between metadata *producers* and the runtime/renderers that *consume* it. When a piece of metadata "doesn't work," ask **first**: *is it spec-compliant? is this the long-term-correct direction?* If the metadata is wrong, fix it at the **producer** and **reject it at authoring/publish** (validation / lint) so the error surfaces loudly — do **not** add a lenient alias or `??` fallback in the consumer (a node executor, the REST layer, a renderer) to tolerate off-spec input. A tolerant fallback fossilizes the wrong convention into a second de-facto contract, dilutes the spec, and hides the producer's bug — one strict contract beats N dialects. This is an **internal** contract (we own both ends), so "be liberal in what you accept" (Postel) does **not** apply — that's for untrusted boundaries. Change the **spec** only when the spec itself is genuinely wrong, and then deliberately (edit the Zod schema + migrate), never by accreting consumer-side fallbacks. The `cfg.filter ?? cfg.filters` / `cfg.objectName ?? cfg.object` fallbacks the flow executors once carried are **debt to pay down, not a pattern to copy** — and the way they are being paid down is the pattern to copy. `filters` → `filter` has **graduated** into the ADR-0087 D2 conversion layer (`flow-node-crud-filter-alias`): rewritten to the canonical key at load, including the `AutomationEngine.registerFlow` rehydration seam, so the CRUD executors read `cfg.filter` directly and no consumer-side fallback survives. `object` → `objectName` and the six open-coded stragglers #3796 tracked (notify `to`/`subject`/`body`/`url`, script `functionName`/`input`) graduated the same way at protocol 17 (`flow-node-crud-object-alias`, `flow-node-notify-config-aliases`, `flow-node-script-config-aliases`), emptying the `readAliasedConfig` executor shim — deleted with them. When you must tolerate an alias at all, declare it as a conversion-layer entry (never a bare `??`, and no new executor shims) so it is declared, loud, tested, and *removable on a schedule*. Stored `sys_metadata` rows (data at rest) are covered from the other side: every rehydration seam replays the **full** conversion chain — retired entries included — via `applyConversionsToStoredItem` (#3903, ADR-0087 addendum), so a consumer never needs its own accommodation for a legacy stored shape either. *Worked example:* an AI-authored `create_record` used `fieldValues` / `today()` / `{{trigger.record.id}}` while the executor reads `fields` / `{TODAY()}` / `{record.id}` → the fix was correcting the authoring skill + a publish-gate lint that rejects the wrong shape (cloud#688), **not** a `cfg.fields ?? cfg.fieldValues` runtime alias (framework#2419, rejected). Strengthens #5.

---

## Multi-agent working discipline

This repo is worked on by **multiple agents in parallel**. **Use one git
worktree per agent/task** (`git worktree add ../objectstack-<task> -b <branch>`;
run `pnpm install` in the new tree) so file systems are physically isolated —
this is mandatory, not a preference (Prime Directive #11), and a PreToolUse hook
blocks edits made while on the shared `main` branch. Working in the shared `main`
checkout is *not* a supported fallback: branches get switched and shared files —
including ones you just wrote — get reset *under you* mid-task (a full session's
work was silently reverted twice before this rule was enforced). Even inside your
own worktree, operate defensively:

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
8. **Testing needs a server? Start your own temporary one — never stop someone
   else's.** A running dev server you didn't start probably belongs to another
   agent or the user; killing it (or its port) breaks their in-flight work. Spin
   up your own instance on a random high port (`pnpm dev -- --fresh -p <random>`)
   and **shut it down yourself when the task is done**
   (`kill $(lsof -ti tcp:<port>)`). Don't leave orphan servers behind.
9. **After pulling `main` into a long-lived worktree, refresh its build state
   before you trust a single test or gate.** A worktree that has been open across
   several merges accumulates artefacts that are stale relative to the source, and
   every one of them fails **as if your change broke something** — naming other
   people's exports, other packages' files, or config you never touched:

   | stale artefact | how it presents | why it lies |
   |---|---|---|
   | `packages/spec/dist` | `check:api-surface` reports *other people's* exports as "N breaking (removed/narrowed)"; `check:i18n-coverage` rejects an example config for a value the spec allows | both read the built `.d.ts`, not `src/` |
   | `node_modules` | a package fails to resolve a dependency it plainly declares (`Cannot find package 'hono'`) | the merge moved `pnpm-lock.yaml` |
   | `packages/runtime/.objectstack/` | `datasource-autoconnect` sees each row 6× | gitignored fixture state accumulating across runs |
   | `.cache/objectui-*` | `pnpm lint` reports dozens of errors in files you have never opened | a full objectui checkout left by `build-console.sh`, linted as if it were ours |

   So after any `git merge origin/main`:
   `pnpm install --frozen-lockfile && pnpm build && rm -rf packages/runtime/.objectstack`
   (add `rm -rf .cache` if you have run the console build). Note `OS_SKIP_DTS=1`
   keeps a build fast but leaves no `.d.ts`, so `gen:api-surface` cannot run at
   all under it — that one needs a real build.

   None of this is CI-visible: CI checks out fresh and installs clean. It costs
   only *your* time, which is exactly why it is worth recognising in one step
   rather than re-diagnosing per gate.
10. **A clean merge is not a working merge.** Git conflicts on overlapping lines;
   nothing warns you when two changes are individually fine and jointly wrong.
   Real examples from one branch's lifetime: a test asserting a response body's
   exact shape landed while that shape was being changed elsewhere (merged clean,
   failed CI); a domain file was deleted while another agent's guard still
   declared it. **Before opening a PR, and again before merging, pull `main` and
   re-run the suite** — the second CI round is where these surface, and the guards
   in `scripts/check-*.mjs` exist largely because this class of breakage is
   invisible to `git merge`.

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
| `**/translations/*.generated.ts` (nine packages — `platform-objects`, five plugins, three services) | **AUTO-GEN** | ❌ Never hand-edit the file *structure*. Run `node scripts/check-i18n-bundles.mjs --write` to regenerate all nine (merge mode — every existing translation is preserved); `pnpm i18n:extract` still covers `platform-objects` alone. Translation *values* are hand-written and expected to be: the gate compares against a merge-mode extract, so editing a string is fine, while adding or dropping keys is drift. `pnpm check:i18n` gates all nine in CI, and `pnpm check:i18n-coverage` ratchets untranslated declared labels. |
| `content/docs/guides/` | hand-written | ✅ Update `meta.json` when adding pages. |
| `content/docs/concepts/` | hand-written | ✅ |
| `content/docs/getting-started/` | hand-written | ✅ |
| `content/docs/protocol/` | hand-written | ✅ |

### Touched `packages/spec`? Regenerate its artifacts BEFORE pushing

`packages/spec` has **eight** checked-in generated artifacts, each with its own CI gate.
All of them live in one job — `TypeScript Type Check` in `lint.yml`, which is required and
has no paths filter, so no gate can go dormant on the PR that breaks it (#4291 retired the
filtered `Check Generated Artifacts` job for exactly that reason). That job runs its gates
**sequentially**, so the first stale artifact masks every one behind it, and you get one
red build per artifact instead of one for all of them. Match the change to the gate and
regenerate up front:

| You changed | Gate that fails | Regenerate with `pnpm --filter @objectstack/spec …` |
|:---|:---|:---|
| A `.describe()` / TSDoc on any schema | `check:docs` | `gen:schema && gen:docs` |
| A public export (added / removed / renamed) | `check:api-surface` | `gen:api-surface` |
| An authorable key on a metadata schema | `check:authorable-surface` | `gen:schema` |
| An ADR-0087 conversion / migration registry | `check:spec-changes`, `check:upgrade-guide` | `gen:spec-changes`, `gen:upgrade-guide` |
| A `SKILL.md` (frontmatter or body) | `check:skill-docs`, `check:skill-refs` | `gen:skill-docs`, `gen:skill-refs` |
| The react-blocks contract | `check:react-blocks` | `gen:react-blocks` |

A `.describe()` string counts — it is not "just a comment", it lands in
`content/docs/references/`. Adding one export counts — it lands in `api-surface.json`.
Both were learned the hard way in #4040: two separate red builds, neither a logic error.

Don't match by hand — one command runs **every** gate and reports **all** stale
artifacts at once, which is precisely what CI cannot do:

```bash
pnpm --filter @objectstack/spec build             # REQUIRED first — see the dist caveat
pnpm --filter @objectstack/spec check:generated   # every gate; the first failure does not stop the rest
pnpm --filter @objectstack/spec check:generated --fix   # regenerate ONLY the ones it proved stale
```

`--fix` is deliberately narrow. Regenerating the whole set on principle destroys the
signal: it rewrites artifacts whose staleness you never saw, so a real semantic change
lands silently inside a mechanical diff. Let the check tell you which are stale, then
regenerate those.

The script carries its own ledger of gate → generator and **reconciles it against
`package.json` on every run**, in both directions. A new `check:`/`gen:` script that
nobody classified fails the run rather than quietly dropping out of coverage — the
failure mode a hardcoded list here would have had. (It caught its own `package.json`
entry on the very first run.) CI runs the same reconciliation on every PR
(`--reconcile-only`, in lint.yml's required typecheck job), so an unclassified script
fails its own PR instead of landing on `main` and turning this wrapper red for
everyone else — which happened twice before the CI step existed (#4203, #4232).

⚠️ **`check:api-surface` reads the built `dist/*.d.ts`, not `src/`.** A stale `dist`
makes it report exports as **removed** — "N breaking (removed/narrowed)" — when nothing
was removed at all: the snapshot is simply newer than your build. Rebuild before you
believe it, and before you file a bug about `main` being red. (Two phantom "breaking
removals" this way while writing this section; `check:generated` now prints this caveat
inline when that gate is the one failing.)

`check:liveness`, `check:empty-state`, `check:skill-examples`,
`check:react-conformance` and `check:exported-any` are pure checks with no generator — a
failure there is a real finding to fix, not an artifact to regenerate. `check:generated`
names them as deliberately not run, so its "all up to date" never reads as "everything
passed".

`check:exported-any` is the one of those that also reads the built `dist/*.d.ts`, so the
stale-`dist` caveat above applies to it too. It asks the other half of the
`api-surface.json` question: that snapshot records an export *exists*, never what it
*resolves to*, which is how five exported symbols sat at `any` for a whole major with
every gate green (#4171). A recursive Zod schema needs an annotation to break its
circular inference, and `z.ZodType<any>` compiles, validates correctly, and silently
throws the type away — annotate with the type instead (`QueryAST` in
`src/data/query.zod.ts` is the pattern).

Two generators have **no** gate at all — `gen:openapi` and `gen:sbom`. Nothing verifies
their output is current; the script reports that each run rather than staying silent
about it.

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

`skills/` is the **published** catalog (it ships to customer projects). Repo-internal
agent playbooks live in `.claude/skills/` and must carry `metadata.internal: true`:
`dogfood-verification` (boot and drive the real app in a browser) and
`spec-property-retirement` (ADR-0049 enforce-or-remove — the full retirement kit).

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

**Plugin** (the kernel contract is `init`/`start`/`destroy` —
`packages/core/src/types.ts`; the old `onInstall`/`onEnable`/`onDisable`
example described hooks nothing ever called, retired in #4212):
```ts
export class MyPlugin implements Plugin {
  name = 'plugin.my-feature';
  async init(ctx: PluginContext)  { /* register services, schemas, routes */ }
  async start(ctx: PluginContext) { /* begin work that needs every service up */ }
  async destroy()                 { /* cleanup */ }
}
```

---

## Route & surface ownership

Four rules, each paid for by a real bug. They matter more than usual here because
this repo is largely written by agents, and every one of them is a trap that
reads as reasonable code.

**1. One route, one owner.** Never add a second implementation of a path that
another package already serves, however convenient. A shadowed duplicate is code
that `grep` finds and the runtime never runs — the exact input that makes an
agent (or a human) reason confidently from dead code. It also silently forks
every future invariant: the retired hono `/data` surface had to re-learn the
anonymous-deny gate (#2567), honest batch capability reporting (#3298) and
discovery accuracy (#4018), each after the fact, each because someone fixed the
real owner and never knew about the copy. Retired in #4073.

**2. Explicit composition over default magic.** A capability that appears
because of a default nobody wrote down is invisible at every call site — and
call sites are the primary evidence an agent reasons from. #4073's own first
analysis checked *who passes the option* and missed *who relies on the default*;
the correction is in that issue's opening paragraph. If a host should get a
surface, it should mount it.

**3. Absence must be loud.** A composition that legitimately serves nothing
should say so once at boot, naming the remedy — never leave a bare 404 to be
diagnosed. The same rule applies to tooling: a verifier that silently degrades
(reusing a stale build, skipping a check it could not run) is worse than no
verifier, because it reports success. Prefer failing to falling back.

**4. Machine-readable surfaces must not lie.** `/discovery` and friends are read
by SDKs, codegen and AI clients. Advertise only what is actually mounted, and
mount everything advertised (ADR-0076 D12) — a wrong answer here propagates into
everything built on top of it.

**Verifying any of this:** "who serves this path" is a question about the
composed, *provisioned* runtime — not about which plugin declares it, not about
registration order, and not about a minimal harness that merely boots. #4073 was
answered wrongly three times, once per each of those shortcuts. Boot the real
composition with its real services, or do not claim an answer.

---

## Post-Task Checklist

1. `pnpm test` — verify nothing broke.
2. **Land it — don't leave passing work in the working tree.** Once tests pass,
   create a feature branch, commit, push, open a PR, and merge it after remote
   CI is fully green (see Multi-agent discipline: never straight to `main`,
   never `gh pr merge --auto`). A finished task = a merged PR, not a dirty
   working tree.
3. **Add a changeset for feature work.** When the change is a feature or functional improvement, run `pnpm changeset` (or add a `.changeset/*.md` entry) describing it before committing. Pure bug fixes do **not** require a changeset.
   **Breaking changesets must carry their migration.** If the change removes or renames anything an author can write (a spec key, an export, a config field), the changeset body must state the FROM → TO mapping and the one-line fix — this text ships to consumers as `CHANGELOG.md` inside the npm package and is what an upgrading agent greps after the tombstone error. Removing an authorable spec key also requires a tombstone so the rejection itself carries the prescription — `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) on a non-strict schema, or an entry in the relevant `UNKNOWN_KEY_GUIDANCE` / `*_RETIRED_KEY_GUIDANCE` map (see `object.zod.ts`, `ai/tool.zod.ts`) when the schema is `.strict()`. The changeset is one of fourteen surfaces a retirement touches — follow the `spec-property-retirement` skill (`.claude/skills/`) rather than reconstructing the kit, and note the two routes imply **opposite** liveness-ledger dispositions.
4. **Added or removed a `packages/spec` export? Run `pnpm --filter @objectstack/spec gen:api-surface` and commit the result.** The `TypeScript Type Check` job diffs spec's built export surface against `api-surface.json`; a new export makes the snapshot stale and turns the job red. It reads the **built `dist` declarations**, so `OS_SKIP_DTS=1` — the flag you reach for to make local builds fast — skips exactly the artifact the gate inspects, and the check passes locally while failing in CI. Same shape for the other generated-artifact gates in that job (`check:docs`, `check:skill-refs`, `check:react-blocks`), which read `src/` and so do reproduce locally.
5. Update `CHANGELOG.md` / `ROADMAP.md` if user-facing or architectural.
6. **Delete temporary artifacts** — screenshots, traces, scratch logs, `.playwright-mcp/`, throwaway `tmp*.ts`, ad-hoc scripts. Repo must look identical to before, minus intended changes.

---

## Edit Sizing

Keep single `edit`/`create` payloads under ~20KB. Split larger changes into multiple sequential edits.
