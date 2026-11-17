---
'@objectstack/scenarios': patch
---

docs(scenarios): the README documents the skill-evals runner

Clause-②: no
Metadata-protocol: none

The package README gains a section on `skill-evals`, a command run from an ObjectStack checkout (`pnpm --filter @objectstack/scenarios skill-evals`). It runs the published skills' existing eval cases (`skills/BUNDLE/evals/*.json`) through the local Claude Code subscription login, each case once with its skill bundle installed and once without, and grades each answer by the case's own `must_contain` / `must_not_contain` tokens. The runner is not in the published `bin` or `exports`, so nothing a consumer installs changes beyond the README text and a `scripts` entry in `package.json`.
