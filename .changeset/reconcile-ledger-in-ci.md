---
"@objectstack/spec": patch
---

`check:generated --reconcile-only` runs the package.json ↔ ledger reconciliation and
nothing else, and lint.yml's unfiltered required job now runs it on every PR.

The aggregate already reconciled its GATED/NO_GENERATOR ledger against `package.json`
on every run, in both directions, so an unclassified `check:`/`gen:` script fails the
run instead of quietly dropping out of coverage. But the reconciliation only executed
where the aggregate executed — locally. CI runs the gates as separate steps, so a PR
adding a script without classifying it kept every CI gate green while
`pnpm --filter @objectstack/spec check:generated` — the wrapper AGENTS.md prescribes
before every spec push — exited at the reconcile stage on `main`, running zero gates.

Not hypothetical: twice in three days. #4177 added `check:variant-docs` and `main`
stayed red for local wrappers until #4194 happened to collide with the same wall
(#4203); #4232 added `check:strictness-ledger`, caught while wiring this very step
and classified in the same change — it audits the hand-written strictness ledger
against the code it describes, so NO_GENERATOR.

The step lives in lint.yml's "TypeScript Type Check" job rather than ci.yml's
`check-generated` job because the latter is gated on a `generated` paths filter that
does not watch `packages/spec/package.json` — the one file every offending PR must
touch; both offenders skipped that job entirely. The typecheck job is unfiltered and
required, so the meta-gate cannot go dormant — the same reasoning that already placed
`check:docs`, `check:skill-refs` and `check:react-blocks` there.
