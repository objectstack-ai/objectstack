---
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(lint,cli): flag flow `update_record` writes to readonly fields at design time (#3425)

A flow `update_record` node that writes a field the target object declares
`readonly: true`, under the default `runAs: 'user'` identity, is a **silent
no-op**: the objectql engine strips static-`readonly` fields from a non-system
UPDATE payload (#2948), so the intended write never lands — yet the step still
reports `success`. #3407/#3413 surfaced the strip as a run-time step warning;
this moves the discovery **left** to `os validate` / `os build` so an author
finds the mismatch at design time instead of by reading server WARN logs days
later.

- New `@objectstack/lint` rule `validateReadonlyFlowWrites(stack)` — a pure
  `(stack) => Finding[]` check (ADR-0019). A static `readonly:true` field
  written by a literal `update_record` under `runAs !== 'system'` is a
  100%-certain no-op → **error** (gates the build). A `readonlyWhen` field is
  per-record-state → **warning** (advisory). Deliberately narrow to stay
  false-positive-free: `create_record` (INSERT is engine-exempt from the strip),
  `runAs: 'system'` flows (the intended "automation maintains it" channel),
  templated object names, and non-literal `fields` maps are all skipped.
- Wired into `os validate` and `os compile`/`os build`, mirroring the existing
  security-posture gate (errors fail; advisories print dimmed).

The formal contract, unchanged in behavior: `readonly` governs the end-user /
API surface (REST/UI and `runAs:'user'` flows strip it); trusted system writers
(`runAs:'system'`, system hooks, seeds) maintain it. To let a flow maintain a
readonly field, declare `runAs: 'system'`.
