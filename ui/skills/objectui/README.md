# ObjectUI Skill

[![skills.sh](https://skills.sh/b/objectstack-ai/objectui)](https://skills.sh/objectstack-ai/objectui)

A single, tree-based Agent Skill consolidating all ObjectUI development knowledge, aligned with [shadcn/ui's skill structure](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn). Works with Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Gemini, Cline, and other agents on [skills.sh](https://skills.sh).

## Install

```bash
npx skills add objectstack-ai/objectui
```

The CLI auto-detects your agent and writes the skill to the right location (e.g. `.claude/skills/objectui/` for Claude Code, `.github/copilot/skills/objectui/` for GitHub Copilot). See [skills.sh/docs](https://skills.sh/docs) for the full list of supported agents.

Once installed, the skill activates automatically when you describe ObjectUI work (schema-driven pages, plugins, `@object-ui/*` packages, etc.). No further configuration required.

## Layout

```
skills/objectui/
├── SKILL.md      # Main entry — core principles, tech stack, package map, JSON protocol
├── rules/        # Non-negotiable global constraints
│   ├── protocol.md
│   ├── styling.md
│   └── composition.md
├── guides/       # Domain-specific deep dives
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
└── evals/        # Evaluation prompts (one per guide)
```

For the full table of contents (rules + guides links), see the **Quick Reference** section in `SKILL.md`.

## How the agent uses it

1. Reads `SKILL.md` for core principles and architecture orientation.
2. Loads the relevant `rules/*.md` to ensure non-negotiables are respected.
3. Pulls one or more `guides/*.md` matching the task.

## Coverage map

The published packages this skill covers. Nothing checks this list against the
`packages/` tree, so read it as a snapshot rather than a guarantee:

- **Core renderer:** `@object-ui/types`, `core`, `components`, `fields`, `layout`, `react`
- **Parsing & runtime:** `@object-ui/sdui-parser`, `react-runtime`
- **Integration:** `@object-ui/app-shell`, `providers`, `runner`, `data-objectstack`
- **Platform features:** `@object-ui/auth`, `permissions`, `i18n`, `mobile`, `collaboration`
- **Plugins (19):** `plugin-{grid, list, detail, form, kanban, calendar, timeline, gantt, dashboard, report, charts, map, editor, markdown, view, tree, designer, ai, chatbot}`
- **Tooling:** `@object-ui/cli`, `create-plugin`, `vscode-extension`

## Reference

- shadcn/ui skill structure: https://github.com/shadcn-ui/ui/tree/main/skills/shadcn
- ObjectUI repository: https://github.com/objectstack-ai/objectui
