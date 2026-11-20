# ObjectStack Skills

Domain-scoped instructions for AI coding assistants (Claude Code, Copilot, Cursor)
working in **any ObjectStack app** — this monorepo *and* third-party projects.
They ship as the npm package `@objectstack/skills`, released with the other
`@objectstack/*` packages at one shared version. Install it at your installed
`@objectstack/spec`'s version — the catalog's version is then your spec's — and
copy it from `node_modules` into your agent's directory:

```bash
pnpm add -D "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"
#   npm: npm install --save-dev "@objectstack/skills@…"   ·   yarn: yarn add -D "@objectstack/skills@…"
npx skills@1.7.2 experimental_sync --agent claude-code --copy -y
```

Add the package with the manager that installed the project: in a pnpm project,
`npm install --save-dev` exits `1`. Keep `--copy`: the skills land as real files
in `.claude/skills/`, to commit with the project; without it they are links into
`node_modules`, which a clone does not have. Name your own runtime after
`--agent` (`codex`, `cursor`, …). To update, bump `@objectstack/skills` with the
other `@objectstack/*` packages, then re-run the sync. The package is published
from `18.0.0-next.0` on (there is no 17.x release); scaffolded projects, the move
from a `skills add` install and the rest are in the
[Skills reference](https://objectstack.ai/docs/ai/skills-reference#installing-skills).

**The `next` channel.** `npx skills add objectstack-ai/objectstack/skills --skill '*' --agent claude-code -y`
reads the catalog straight from the repository's unreleased `main` — for trying
the next version's skills, not for a released project.

Each **domain** skill is self-contained: a `SKILL.md` with YAML frontmatter, plus a
`references/_index.md` that points into the authoritative Zod sources in
`node_modules/@objectstack/spec/src/...` (the published `@objectstack/spec`
package ships these `.zod.ts` sources, so the pointers resolve in consumer
apps too).

> **Always read the spec source for exact field shapes.** Skills give shape and
> intent; the Zod schemas are the truth.

---

## Index

<!-- BEGIN GENERATED: skills (packages/spec/scripts/build-skill-docs.ts) — DO NOT EDIT -->

| Skill | Domain | What it covers |
|:------|:-------|:---------------|
| [Platform](./objectstack-platform/SKILL.md) | `platform` | Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers project setup (`defineStack`, drivers, scaffolding), declaring platform capabilities (`requires:` — which service plugins boot), plugin and service development (PluginContext, DI, kernel hooks like `kernel:ready`), and operations (CLI commands, migrations, deployment, test harnesses via LiteKernel). |
| [Data](./objectstack-data/SKILL.md) | `data` | Design or change an ObjectStack data model, in a project or through MCP: objects, fields, relationships, validation rules, indexes, record hooks, permissions, seed / demo data, external datasources, and field `visibleWhen` / `requiredWhen` rules. |
| [Query](./objectstack-query/SKILL.md) | `query` | Write an ObjectQL query over ObjectStack records: filter, sort, paginate, aggregate by group, expand related records, full-text search. |
| [UI](./objectstack-ui/SKILL.md) | `ui` | Build what users see in an ObjectStack app, in a project or through MCP: list / form / kanban / calendar views, navigation, pages, dashboards, reports, charts, action buttons and package docs. |
| [Automation](./objectstack-automation/SKILL.md) | `automation` | Automate an ObjectStack app, in a project or through MCP: act when a record is created or changes, on a schedule or from a webhook; approvals, notifications, assignment rules, and screen flows / wizards that branch between steps. |
| [AI](./objectstack-ai/SKILL.md) | `ai` | Design ObjectStack AI skills, tools, knowledge sources, and the open-edition MCP server surface. |
| [API](./objectstack-api/SKILL.md) | `api` | Design the server-side API surface that an ObjectStack runtime exposes — REST endpoints, auth providers, realtime channels, error envelopes, batch contracts. |
| [i18n](./objectstack-i18n/SKILL.md) | `i18n` | Translate an ObjectStack app, in a project or through MCP: object and field labels, select options, view, navigation and dashboard text, automation messages; add a locale, and find and fill missing keys (`os i18n check`). |
| [Formula](./objectstack-formula/SKILL.md) | `expression` | Write a CEL expression wherever ObjectStack takes one, in a project or through MCP: formula fields, `visibleWhen` / `requiredWhen` rules, validation, sharing and visibility predicates, flow conditions, seed values, Salesforce formulas ported to CEL. |
| [Upgrade](./objectstack-upgrade/SKILL.md) | `process` | Upgrade an ObjectStack metadata project across a protocol major — run the deterministic conversion chain, then work the semantic residue the chain cannot express (intent choices, custom code on retired APIs, stale prose) to a decision with the project's owner, and finish with a green `validate` plus a human-readable upgrade report. |
| [Ask](./objectstack-ask/SKILL.md) | `process` | Answer a business question over a live ObjectStack environment through its MCP tools (list_datasets, query_dataset, list_objects, describe_object, query_records, aggregate_records): find the governed metric the question names, compute it and cite its source, or fall back to an object query and say so. |
| [MCP Build](./objectstack-mcp-build/SKILL.md) | `process` | Build or change an ObjectStack app's metadata through its MCP draft door (list_metadata_items, get_metadata_item, save_metadata_draft, list_drafts, delete_metadata_draft), with no project files: read what exists, load the type's domain skill, save a draft, read the publish verdict the save answers, repair it, and hand the Studio review route to a person. |
| [Project](./objectstack-project/SKILL.md) | `process` | Run an ObjectStack metadata-app project: decide whether a change belongs in the app or the platform, what to write before building, what the app tests and what the platform already checks, how a change is described for customers, released and upgraded. |
| [ObjectUI](./objectui/SKILL.md) | `ui` | Universal Server-Driven UI (SDUI) engine for building JSON-driven React interfaces with Shadcn design quality. |

<!-- END GENERATED: skills -->

> Regenerate with `pnpm --filter @objectstack/spec gen:skill-docs` after editing any `SKILL.md` frontmatter.

---

## Skill anatomy

```
skills/<skill-name>/
├── SKILL.md              # frontmatter + prose guide
├── references/           # may also hold hand-authored reference files linked from SKILL.md
│   └── _index.md         # generated pointers into @objectstack/spec sources
│                         # (pnpm --filter @objectstack/spec gen:skill-refs — do not hand-edit)
├── rules/                # (optional) detailed per-topic rule files linked from SKILL.md
├── contracts/            # (optional) generated machine-readable contracts (e.g. react-blocks)
└── evals/                # skill eval fixtures — used by maintainers to score the skill,
                          # inert (but harmless) in consumer installs
```

A `process` skill (`metadata.domain: process`) points at no Zod schema, so it
carries `SKILL.md` alone — `gen:skill-refs` only visits skills listed in its
`SKILL_MAP`, and there is nothing to map.

`SKILL.md` frontmatter fields:

| Field | Purpose |
|:------|:--------|
| `name` | Stable id (matches directory name). |
| `description` | One paragraph — what the skill is for *and* what it is **not** for. |
| `license` | `Apache-2.0`. |
| `compatibility` | Minimum `@objectstack/spec` version — or, for a `process` skill that binds to no schema, the tooling it needs. |
| `metadata.domain` | Authoring domain — one of: `platform`, `data`, `query`, `ui`, `automation`, `ai`, `api`, `i18n`, `expression` — or `process` for a delivery-process skill that teaches no schema. |
| `metadata.tags` | Short comma-separated keywords for retrieval. |

---

## Conventions enforced across skills

- **Zod first.** Never invent types — read `node_modules/@objectstack/spec/src/**/*.zod.ts`.
- **Objects, docs, capabilities and positions carry the namespace** (`crm_account`;
  a snippet with no manifest uses `crm`); other names stay short (`send_email`).
  The one rule lives in `objectstack-platform/SKILL.md`.
- **Short object names in snippets** (`account`, `task`); no object-level
  `namespace`, no `tableName`.
- **CEL for all expressions** — predicates, conditions, schedules. Use the
  `F\`\``, `P\`\``, `cel\`\``, `cron\`\``, `tmpl\`\`` tagged templates from
  `@objectstack/spec`. Legacy `OLD` / `NEW` are not CEL — use
  `previous.` / `record.`.
- **v5.0 vocabulary** — runtime workspace is `environment`, not `project`.
- **Singular metadata type names** (`agent`, `view`, `flow`, …); REST resource
  collections are plural (`/api/v1/ai/agents`).

---

## Cross-skill routing

A few common decision points where the right skill isn't obvious:

- **Lifecycle hooks on data vs. business automation** — object-level hooks
  (`beforeInsert`, etc.) live in **objectstack-data**; cross-record orchestration,
  approvals, and scheduled work live in **objectstack-automation**.
- **Screen flows vs. views** — a stepped form over one object that never branches
  is **ui** (a form view, `type: 'wizard'`); a screen flow that branches, or steps
  across several objects, is **automation**. Static record / list / dashboard surfaces are **ui**.
- **Any CEL expression** — load **objectstack-formula** alongside the host
  skill (data validations, automation guards, UI visibility).
- **Kernel / plugin events vs. data lifecycle** — `PluginContext` lifecycle and
  `EventBus` belong to **objectstack-platform**; record-level hooks belong to
  **objectstack-data**.
- **Labels vs. bundles** — a `label` you want translated is **objectstack-i18n**.
- **Upgrade vs. platform** — a protocol-major move is **objectstack-upgrade**.
- **Writing metadata vs. running the project** — where a change belongs, what
  the app tests, releases and pin bumps are **objectstack-project**.
- **Building over MCP, with no project files** — the order of work at the
  draft door is **objectstack-mcp-build**; the shapes stay in the domain skills.
- **Rendering this metadata** — the consuming UI is the `@object-ui/*`
  packages, and their own skill is [`objectui`](./objectui/SKILL.md) in this catalog.

---

## Related code

- [`ui/`](https://github.com/objectstack-ai/objectstack/tree/main/ui) — the ObjectUI
  packages (`@object-ui/*`), in this repository.
