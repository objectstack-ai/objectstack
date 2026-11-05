---
'@objectstack/cli': patch
---

feat(cli): the scenario scorer judges capability tags, agent-action exposure, write outcomes and per-persona answers — deterministic modules under `src/lint`

Clause-②: no
Metadata-protocol: none

- **Capability-tag checks** (`src/lint/scenario-tags.ts`): a closed tag → check table over a built `dist/objectstack.json` — `records-forms.lookup`, `records-forms.master-detail-inline-edit`, `records-forms.roll-up-summary`, `records-forms.select-options`, `access-security.field-permissions`, `access-security.row-scope`, `approvals.approval-flow`, `automation.record-triggered-flow` and `dashboards.widget-measures`. A tag with no row, or whose row finds nothing in the card to judge, is reported `unscored` and counted in neither the passed nor the total figure; a row that runs no check fails.
- **Agent-action exposure** (`gradeAgentActions`): each action a scenario declares must exist on its object, carry `ai.exposed: true` (the MCP doors' opt-in) and, where the scenario says it asks first, `ai.requiresConfirmation: true` (the flag the confirmation gate enforces, not the delete-mode listing heuristic). A declared action the build does not carry fails every one of those checks.
- **`scoreScenarioArtifact`** scores one build against one scenario: its `expect` by exact name (the shape score reported beside it), its tags and its agent actions, as `passed / total` with `score: null` when nothing was scored.
- **Write-operation grader** (`src/lint/scenario-operation-grade.ts`): `gradeOperation` judges an observed write against its declared outcome — applied (every post-state read back, one row per `where`, and the audit actor), refused (the exact code, nothing written) or pending confirmation (nothing written). A fact the observation does not carry fails.
- **Per-persona Run grading** (`gradePersonaRun` in `src/lint/scenario-run-grade.ts`): grades a persona's turn against that persona's computed truth; a withheld truth is must-not-reveal (a decline is correct, a stated all-rows figure is a leak), and an all-rows figure outside a scoped persona's rows is a leak when the reply states it.

No model call anywhere, no new CLI flag and no new package-entry export: nothing in the shipped commands calls these modules yet.
