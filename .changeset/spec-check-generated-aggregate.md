---
'@objectstack/spec': patch
---

`check:generated` — one command that reports every stale generated artifact, instead of one red build per artifact.

`packages/spec` has eight checked-in generated artifacts, each with its own gate, split
across two CI jobs that run their gates **sequentially**. So the first stale artifact
masks every one behind it: you fix it, push, and learn about the next one on the
following run. That cost two pushes on #4040 (`check:docs`, then `check:api-surface`) and
two more on #4161 (`check:spec-changes`, then `check:upgrade-guide`) — four round trips
spent discovering something one local run could have said at once.

- Every gate runs; a failure does not stop the rest. The summary lists all stale
  artifacts with the exact `gen:` command for each.
- `--fix` regenerates **only** the artifacts this run proved stale. Deliberately not a
  "regenerate everything" button: blanket regeneration rewrites artifacts whose staleness
  you never saw, which is how a real semantic change lands silently inside a mechanical
  diff.
- The gate → generator ledger is **reconciled against `package.json` on every run**, both
  directions, rather than behind a `--self-test` flag. A new `check:`/`gen:` script that
  nobody classified fails the run instead of quietly dropping out of coverage — otherwise
  the summary would still say "all artifacts up to date" while silently checking fewer,
  which is the exact class of lie this script exists to remove. It proved itself
  immediately by rejecting its own `package.json` entry on the first run.
- The `check:api-surface` stale-`dist` trap (it reads the built `.d.ts`, so an unbuilt
  tree reports every newly-added export as a "breaking removal") is flagged inline when
  that gate is the one failing, instead of leaving the next reader to chase a phantom.
- What it deliberately does **not** run is named in the output: the four source audits
  with no artifact (`check:liveness`, `check:empty-state`, `check:react-conformance`,
  `check:skill-examples`), so "all up to date" never reads as "everything passed".

It also surfaces a standing gap rather than staying quiet about it: `gen:openapi` and
`gen:sbom` produce artifacts that **no gate verifies**.

Verified both directions: on a clean built tree all 8 pass; injecting a change into a
migration step's `rationale` makes `check:upgrade-guide` fail and `--fix` regenerates
that one artifact and no other. The same run also showed the two gates have different
inputs — the conversion registry drives `spec-changes.json`, the rationale prose drives
`protocol-upgrade-guide.md` — which the earlier "both failed together" reading had
conflated.

AGENTS.md's hand-rolled loop over eight hardcoded gate names is replaced by the command;
that list could not survive a ninth artifact, and the script's ledger can.
