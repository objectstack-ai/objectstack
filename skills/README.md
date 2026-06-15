# ObjectStack Skills

Domain-scoped instructions for AI coding assistants (Claude Code, Copilot, Cursor)
working in the ObjectStack monorepo. Each skill is self-contained: a `SKILL.md`
with YAML frontmatter, plus a `references/_index.md` that points into the
authoritative Zod sources in `node_modules/@objectstack/spec/src/...`.

> **Always read the spec source for exact field shapes.** Skills give shape and
> intent; the Zod schemas are the truth.

---

## Index

<!-- BEGIN GENERATED: skills (packages/spec/scripts/build-skill-docs.ts) — DO NOT EDIT -->

| Skill | Domain | What it covers |
|:------|:-------|:---------------|
| [Platform](./objectstack-platform/SKILL.md) | `platform` | Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers project setup (`defineStack`, drivers, adapters, scaffolding), plugin and service development (PluginContext, DI, kernel hooks like `kernel:ready` and `data:*`), and operations (CLI commands, migrations, deployment, test harnesses via LiteKernel). |
| [Data](./objectstack-data/SKILL.md) | `data` | Design ObjectStack data schemas — objects, fields, field conditional rules, relationships, validations, indexes, lifecycle hooks, permissions, row-level security — and the seed datasets (`defineDataset()`) that load fixtures and reference data alongside them. |
| [Query](./objectstack-query/SKILL.md) | `query` | Construct ObjectQL queries — filters, sorting, pagination, aggregation, joins/expansion, window functions, and full-text search. |
| [UI](./objectstack-ui/SKILL.md) | `ui` | Author ObjectStack UI metadata — Views (list/form/kanban/calendar/gantt), Apps (navigation), Pages, Dashboards, Reports, Charts, Actions, and package Docs (`src/docs/*.md`). |
| [Automation](./objectstack-automation/SKILL.md) | `automation` | Design ObjectStack automation — Flows (visual logic), Workflows (declarative rules), Triggers, Approvals, scheduled jobs, and webhooks. |
| [AI](./objectstack-ai/SKILL.md) | `ai` | Design ObjectStack AI agents, tools, skills, conversations, model registry entries, and MCP integrations. |
| [API](./objectstack-api/SKILL.md) | `api` | Design the server-side API surface that an ObjectStack runtime exposes — REST/GraphQL endpoints, auth providers, realtime channels, error envelopes, batch/versioning contracts. |
| [i18n](./objectstack-i18n/SKILL.md) | `i18n` | Author ObjectStack translation bundles — object/field labels, view text, app navigation strings, automation messages — and configure locale fallback, coverage reporting, and the per-locale source layout. |
| [Formula](./objectstack-formula/SKILL.md) | `expression` | Author CEL expressions used across ObjectStack — formula fields, field conditional rules (`visibleWhen`, `readonlyWhen`, `requiredWhen`), validation / sharing / visibility predicates, flow conditions, and dynamic seed values. |

<!-- END GENERATED: skills -->

> Regenerate with `pnpm --filter @objectstack/spec gen:skill-docs` after editing any `SKILL.md` frontmatter.

---

## Skill anatomy

```
skills/<skill-name>/
├── SKILL.md              # frontmatter + prose guide
└── references/
    └── _index.md         # pointers into @objectstack/spec sources
```

`SKILL.md` frontmatter fields:

| Field | Purpose |
|:------|:--------|
| `name` | Stable id (matches directory name). |
| `description` | One paragraph — what the skill is for *and* what it is **not** for. |
| `license` | `Apache-2.0`. |
| `compatibility` | Minimum `@objectstack/spec` version. |
| `metadata.domain` | One of: `platform`, `data`, `query`, `ui`, `automation`, `ai`, `api`, `i18n`, `formula`. |
| `metadata.tags` | Short comma-separated keywords for retrieval. |

---

## Conventions enforced across skills

- **Zod first.** Never invent types — read `node_modules/@objectstack/spec/src/**/*.zod.ts`.
- **Short object names** (`account`, `task`); no `namespace`, no `tableName`.
- **CEL for all expressions** — predicates, conditions, schedules. Use the
  `F\`\``, `P\`\``, `cel\`\``, `cron\`\``, `tmpl\`\`` tagged templates from
  `@objectstack/spec`. Legacy `OLD` / `NEW` evaluate to `null` since M9.5.
- **v5.0 vocabulary** — runtime workspace is `environment`, not `project`.
- **Singular metadata type names** (`agent`, `view`, `flow`, …); REST resource
  collections are plural (`/api/v1/ai/agents`).

---

## Cross-skill routing

A few common decision points where the right skill isn't obvious:

- **Lifecycle hooks on data vs. business automation** — object-level hooks
  (`beforeInsert`, etc.) live in **objectstack-data**; cross-record orchestration,
  approvals, and scheduled work live in **objectstack-automation**.
- **Screen flows vs. views** — interactive wizards / multi-step forms are
  **automation** (screen flows). Static record / list / dashboard surfaces are
  **ui**.
- **Any CEL expression** — load **objectstack-formula** alongside the host
  skill (data validations, automation guards, UI visibility, AI tool params).
- **Kernel / plugin events vs. data lifecycle** — `PluginContext` lifecycle and
  `EventBus` belong to **objectstack-platform**; record-level hooks belong to
  **objectstack-data**.

---

## Related repositories

- [`../objectui`](https://github.com/objectstack-ai/objectui) — Studio UI (separate repo).
- [`../templates`](https://github.com/objectstack-ai/templates) — template library
  consumed by `create-objectstack` (separate repo). Scaffolds reference these
  skills; keep this index in sync when adding or renaming a skill.
