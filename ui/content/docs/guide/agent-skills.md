---
title: "Agent Skills"
description: "Install the ObjectUI Agent Skill into Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Gemini, Cline, and other agents with a single command."
---

# Agent Skills

ObjectUI ships an official **Agent Skill** — a structured bundle of rules, guides, and evals that teaches AI coding agents how to build pages, plugins, and integrations the *right* way (schema-first, no-touch zones respected, English-only, expression-aware).

The skill is published on [skills.sh](https://skills.sh/objectstack-ai/objectui) and lives in [`skills/objectui/`](https://github.com/objectstack-ai/objectui/tree/main/skills/objectui) inside this repository.

[![skills.sh](https://skills.sh/b/objectstack-ai/objectui)](https://skills.sh/objectstack-ai/objectui)

## Install

One command, in your project root:

```bash
npx skills add objectstack-ai/objectui
```

The `skills` CLI auto-detects which AI agent you're using and writes the skill to the location that agent reads from — for example:

| Agent | Install location |
| --- | --- |
| Claude Code | `.claude/skills/objectui/` |
| GitHub Copilot | `.github/copilot/skills/objectui/` |
| Cursor | `.cursor/skills/objectui/` |
| Codex | `.codex/skills/objectui/` |
| Windsurf, Gemini, Cline, Goose, Kilo, Droid, Trae, … | per-agent path |

See [skills.sh/docs](https://skills.sh/docs) for the full, up-to-date list of supported agents.

## What you get

Once installed the skill activates automatically whenever you describe ObjectUI work in chat. Nothing to import, nothing to configure.

The skill is structured as a single entry point plus deep-dive guides:

```
skills/objectui/
├── SKILL.md         # Entry point — core principles, tech stack, scope
├── rules/           # Non-negotiable global constraints
│   ├── protocol.md
│   ├── styling.md
│   └── composition.md
├── guides/          # Domain-specific deep dives, loaded on demand
│   ├── architecture.md
│   ├── app-composition.md
│   ├── page-builder.md
│   ├── plugin-development.md
│   ├── schema-expressions.md
│   ├── data-integration.md
│   ├── project-setup.md
│   ├── testing.md
│   ├── i18n.md
│   ├── mobile.md
│   └── auth-permissions.md
└── evals/           # Machine-checkable prompts (one per guide)
```

Two files that once shipped in this bundle — `rules/no-touch-zones.md` and
`guides/console-development.md` — moved into the repo-internal
[`.claude/skills/objectui-contributor/`](https://github.com/objectstack-ai/objectui/tree/main/.claude/skills/objectui-contributor)
skill instead. Both talk about paths that only exist inside this monorepo — `apps/console/`
and `packages/components/src/ui/` — which a customer install of the published skill never
has, so they stayed behind as contributor-only guidance rather than shipping to every
consumer.

When the agent picks up a task it:

1. Reads `SKILL.md` for core principles, scope boundaries, and the package map.
2. Loads the relevant `rules/*.md` so non-negotiables (Shadcn purity, expression syntax, layout composition) are respected.
3. Pulls the matching `guides/*.md` for the task at hand.

## What the skill enforces

The skill bakes the ObjectUI worldview into every answer your agent gives you:

- **Schema-first**: page output is JSON for `<SchemaRenderer>`, not bespoke React.
- **Shadcn-native aesthetics**: components stay in Tailwind + `cn()` + `cva`; no inline styles, no CSS-in-JS.
- **Protocol agnostic**: data goes through the `DataSource` interface, not raw `fetch`/`axios`.
- **Expression-aware**: `visible`, `hidden`, `disabled` use `${data.*}` / `${props.*}` templates, never raw JS.
- **No-touch zones**: upstream Shadcn primitives in `packages/components/src/ui/**` are never edited — extensions live in `custom/` wrappers.
- **English-only**: all generated component text, labels, comments, and docs are English.
- **Scope discipline**: the skill explicitly defers backend/data-modelling questions to the `objectstack-*` skills, so it stays focused on the UI engine.

Each rule has a machine-checkable eval under `evals/`, so regressions in agent behaviour are caught the same way regressions in code are.

## When *not* to use it

If your question is purely about data modelling, kernel plugins, ObjectQL queries, CEL formulas, or server-side automation, prefer the matching `objectstack-*` skill. The ObjectUI skill's frontmatter explicitly defers those topics so multiple skills can coexist cleanly in your agent.

## Updating

To pull the latest version of the skill after we ship improvements:

```bash
npx skills add objectstack-ai/objectui
```

The CLI is idempotent — running it again refreshes the local copy in place.

## Contributing

The skill source lives in [`skills/objectui/`](https://github.com/objectstack-ai/objectui/tree/main/skills/objectui). PRs are welcome — see [`skills/objectui/README.md`](https://github.com/objectstack-ai/objectui/blob/main/skills/objectui/README.md) for the maintenance rules (guide ↔ eval naming, English-only, eval assertion format).
