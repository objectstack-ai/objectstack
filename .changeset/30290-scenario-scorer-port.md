---
'@objectstack/cli': patch
---

feat(cli): a deterministic scenario scorer under `src/lint` — the structural shape score, an artifact-to-graph reader and a Run-half grader, ported from the cloud eval harness

Clause-②: no
Metadata-protocol: none

- **Structural scorer** (`src/lint/scenario-score.ts`): `scoreGraph` matches a scenario's `expect` block by exact name, `scoreGraphShape` scores the build's shape regardless of names, and `deriveShape` turns the first into the second. Two checks that let a degraded build score as high as an intact one are closed: an expected nav target now passes only when an app navigates to it through an entry that resolves (every app nav entry is also scored for resolving), and a dashboard widget bound to a dataset the build does not carry now fails its measure check.
- **Artifact reader** (`src/lint/scenario-graph.ts`): reads a built `dist/objectstack.json` into the scorer's graph, single-package or with its collections only under `packages[]` (ADR-0130), through the shared `resolveStackCollection` rule, reading each key in its one spec shape and refusing an unreadable object instead of scoring it as an empty one.
- **Run grader** (`src/lint/scenario-run-grade.ts`): grades one agent turn against a question's computed truth as `{ correct, cited, leaks, problems }` — figures matched (with `万` / `亿` / `k` / `M` read), each figure's object cited, and hidden values, hidden aggregates and tool calls answered over a hidden field or object reported as leaks, in the reply or in any tool output.

No model call anywhere, no new CLI flag and no new package-entry export: nothing calls these yet; the `os lint --eval` wiring is a later change.
