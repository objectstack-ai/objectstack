---
"@objectstack/cli": patch
---

fix(cli): the `os environments` family calls the entity an environment, not a project, in every string it prints (#12153)

Per ADR-0006 the v5.0 rename `project` → `environment` has no aliases, and AGENTS.md
states "Project now only means the npm/monorepo sense". #10967 (PR #11227) renamed the
**command** (`os projects …` → `os environments …`) across these same five files; the
**entity noun** inside the strings oclif prints was left behind. A user ran
`os environments switch <id>` and the tool answered `✓ Active project: …`.

25 user-visible string literals in `packages/cli/src/commands/environments/` are swapped
to the post-rename noun. No behaviour, no flag or argument names, no exit codes, and no
`--format json` / `--format yaml` payloads change — those are produced by
`formatOutput(res, …)` straight from the control-plane response and are untouched.

| where | count | printed by |
| --- | --- | --- |
| `static override description` | 5 | `os environments --help` |
| flag / arg `description` | 7 | each command's own `--help` |
| success-path console output | 9 | `list` · `bind` · `create` · `show` · `switch` |
| `examples` arg placeholder (`<project-id>` → `<environment-id>`) | 3 | `os environments bind --help` |
| the `switch` id-not-found error | 1 | `os environments switch` on a bad id |

The five `static override description` strings now read as
`content/docs/deployment/cli.mdx`'s command table has described them since the rename
("List environments visible to the current session", "Provision a new environment", …),
so the shipped `--help` and the shipped docs agree for the first time.

What is deliberately NOT renamed, because it is API surface in other packages rather than
CLI wording, and each needs its own decision: `client.projects.*` (the `@objectstack/client`
SDK method names), the `res.project` / `res.projects` response fields, the locals bound
directly from them, and the docblock comments in these files.
