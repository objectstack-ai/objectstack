# ObjectStack Skills

Domain-scoped instructions for AI coding assistants (Claude Code, Copilot, Cursor)
working in **any ObjectStack app** — this monorepo *and* third-party projects.
`npm create objectstack` installs them into new apps automatically; existing
projects add (or update) the bundle with:

```bash
npx skills add objectstack-ai/objectstack/skills --all
```

The `/skills` subpath matters: it is the published catalog boundary — pointing
the skills CLI at the repo root would also pick up repo-internal skills (#3101).

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
| [Platform](./objectstack-platform/SKILL.md) | `platform` | Bootstrap, configure, extend, and operate ObjectStack runtimes. Covers project setup (`defineStack`, drivers, adapters, scaffolding), plugin and service development (PluginContext, DI, kernel hooks like `kernel:ready`), and operations (CLI commands, migrations, deployment, test harnesses via LiteKernel). |
| [Data](./objectstack-data/SKILL.md) | `data` | Design ObjectStack data schemas — objects, fields, field conditional rules, relationships, validations, indexes, lifecycle hooks, permissions, row-level security — and the seeds (`defineSeed()`) that load fixtures and reference data alongside them. |
| [Query](./objectstack-query/SKILL.md) | `query` | Construct ObjectQL queries — filters, sorting, pagination, aggregation, relation expansion, and full-text search. |
| [UI](./objectstack-ui/SKILL.md) | `ui` | Author ObjectStack UI metadata — Views (list/form/kanban/calendar/gantt), Apps (navigation), Pages (structured plus the HTML and React source-authoring tiers, ADR-0080/0081), Dashboards, Reports, Charts, Actions, and package Docs (`src/docs/*.md`). |
| [Automation](./objectstack-automation/SKILL.md) | `automation` | Design ObjectStack automation — Flows (visual logic), Triggers, Approvals, state machines, scheduled jobs, and webhooks. |
| [AI](./objectstack-ai/SKILL.md) | `ai` | Design ObjectStack AI skills, tools, knowledge sources, conversations, model registry entries, and MCP integrations. |
| [API](./objectstack-api/SKILL.md) | `api` | Design the server-side API surface that an ObjectStack runtime exposes — REST endpoints, auth providers, realtime channels, error envelopes, batch/versioning contracts. |
| [i18n](./objectstack-i18n/SKILL.md) | `i18n` | Author ObjectStack translation bundles — object/field labels, view text, app navigation strings, automation messages — and configure locale fallback, coverage reporting, and the per-locale source layout. |
| [Formula](./objectstack-formula/SKILL.md) | `expression` | Author CEL expressions used across ObjectStack — formula fields, field conditional rules (`visibleWhen`, `readonlyWhen`, `requiredWhen`), validation / sharing / visibility predicates, flow conditions, and dynamic seed values. |
| [PM Dispatch](./objectstack-pm-dispatch/SKILL.md) | `process` | Run a project-manager dispatch loop over a GitHub backlog: triage and queue ready issues, claim each one, dispatch it to a parallel developer agent that returns a structured JSON report, review the results against GitHub, and drive accepted pull requests to landing — escalating to the maintainer only what genuinely needs a human decision. Ships the developer-agent operating template the loop injects into every dispatch (no custom agent types required) and the upstream-reporting procedure for platform defects an app project finds. |
| [Upgrade](./objectstack-upgrade/SKILL.md) | `process` | Upgrade an ObjectStack metadata project across a protocol major — run the deterministic conversion chain, then work the semantic residue the chain cannot express (intent choices, custom code on retired APIs, stale prose) to a decision with the project's owner, and finish with a green `validate` plus a human-readable upgrade report. |

<!-- END GENERATED: skills -->

> Regenerate with `pnpm --filter @objectstack/spec gen:skill-docs` after editing any `SKILL.md` frontmatter.

---

## Skill anatomy

```
skills/<skill-name>/
├── SKILL.md              # frontmatter + prose guide
├── references/
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
