---
"@objectstack/spec": patch
---

Retire ci.yml's `generated` paths filter and its `Check Generated Artifacts` job; every
spec artifact gate now runs in lint.yml's unfiltered, required TypeScript Type Check job.

The filter was a hand-maintained duplicate of each gate's input set, and nothing
reconciled the two. It drifted three times on record, each found by accident and written
up in a comment rather than gated:

- #2584 moved a generated page and the filter kept watching the old path, so hand-edits
  to the generated block went unchecked for months.
- #3855 listed specific spec paths but no schema dirs, so `check:authorable-surface` went
  dormant on exactly the PRs that remove an authorable key.
- `packages/spec/json-schema.manifest.json` — the #2978 ratchet, and the only durable
  record of every schema ever emitted since `json-schema/` is gitignored — was never
  watched at all, so a PR retiring a key from it skipped its own verifier.

Six of the ten gates had already escaped to the typecheck job one at a time, each with a
comment explaining that the filter had failed them. This moves the last four
(`check:skill-docs`, `check:spec-changes`, `check:upgrade-guide`,
`check:authorable-surface`) and deletes the filter, so there is no second ledger to keep
in sync — the failure mode #4255 fixed for the `check:generated` ledger, removed at the
source here rather than gated.

Affordable because the work was already being done: `check:docs` in that job runs
`gen:schema` — the same `scripts/build-schemas.ts` that backs `check:authorable-surface` —
and that entire step measures 4s in CI, against a 5-minute job dominated by the workspace
build. All four read source via tsx and need no build.
