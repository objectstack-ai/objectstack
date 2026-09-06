---
"create-objectstack": minor
---

Scaffolded projects now ship a CI workflow, and a `lint` script for it to run.
The blank template carries `.github/workflows/ci.yml` — one job, on `push` and
`pull_request`: checkout, pnpm, Node 22, `pnpm install --frozen-lockfile`, then
`pnpm validate`, `pnpm lint` and `pnpm typecheck`.

`lint` is new to the template (`objectstack lint`). It is not a second spelling
of `validate`: the two share the authoring-rule engine but only `lint` runs the
hook-body lowering check, which catches handlers that have silently stopped
lowering to metadata-only bodies — a change of deployment shape produced by a
refactor that looks like tidying.

The scaffolder already created `.github/` at runtime for a single file
(`copilot-instructions.md`) while the template's gates shipped as npm scripts
nothing ever ran, so a fresh project started with no CI at all — and ObjectStack
metadata mistakes fail silently at runtime, which makes `objectstack validate`
the only place they surface early. That gate is now unskippable for a human and
for an AI agent authoring metadata in the project, instead of advisory.

Existing projects are unaffected; copy the file from a fresh scaffold to adopt
it.
