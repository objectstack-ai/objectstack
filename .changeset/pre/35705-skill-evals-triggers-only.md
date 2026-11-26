---
'@objectstack/scenarios': patch
---

skill-evals: `--triggers-only` runs the selected bundles' trigger cases alone

Clause-②: no
Metadata-protocol: none

`pnpm --filter @objectstack/scenarios skill-evals --triggers-only` selects only the `should_trigger` cases of the selected bundles, on the with-skill arm, so a change to when a skill loads is measured on its trigger cases alone: the six metadata bundles plan 42 turns instead of 354. The summary is the trigger section alone; `round.json` records `scope.triggersOnly`, and `--regrade` keeps that scope. It works with `--dry-run` and `--skills-from VERSION`. It is refused beside `--regrade` or `--self-test`, and a bundle named in `--skills` with no trigger case is refused. The README section "Running the published skills' eval cases" documents it.
