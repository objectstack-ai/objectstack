---
"@objectstack/cli": minor
---

fix(cli): `os migrate plan` / `apply` exit non-zero when the host config exists but could not be loaded (#12953)

A host `objectstack.config.{ts,js,mjs}` that EXISTS and throws while loading — a
missing environment variable is the ordinary cause, and ObjectStack Cloud's own
control-plane config throws without `AUTH_SECRET` — used to warn loudly and then
**exit 0**. The object set the commands diffed on that path is the data stack
plus the platform floor: nine tables, none of them the deployment's, and `0`
drift over them printed "Physical schema is in sync with metadata — nothing to
migrate". Measured on the fixture this ships with, before the change: `plan`,
`plan --json`, `apply --yes` and `apply --yes --json` all returned `0`.

Maintainer ruling 2026-08-29, verbatim 「同意」: a green exit over an UNMEASURED
partial metadata set is the false-green a migration tool must never emit, and
the population this "regresses" was computing defective plans all along. Both
commands now exit **non-zero** on that path, with an error on stderr naming the
config file, the underlying failure, and the remedy.

**BEHAVIOUR CHANGE to exit status**, shipped as `minor` under the repo's
launch-window convention. It is scoped to exactly one shape, and the two
neighbouring ones were measured byte-identical before and after — stdout *and*
stderr, human and `--json`, for both commands:

- host config **present and unloadable** → non-zero (this change);
- host config **absent** → unchanged, still exit 0. `hostConfigLoaded` is
  `false` on that shape too, so the refusal keys on `hostConfigPath !== null`
  rather than on the flag alone;
- host config **present and loadable** → unchanged, still exit 0.

Everything the previous behaviour emitted is kept, deliberately: the loud stderr
warning, and the `composition.hostConfigLoaded` discriminator in the `--json`
payload that consumer coverage gates (objectstack-ai/cloud#1705) read — a table
count cannot replace it, because the platform floor raises the count either way.
The refusal changes the exit STATUS, not the document: the whole plan, or the
whole JSON payload, is still written before the process exits non-zero, and the
unloadable path's payload is byte-identical to the one it emitted before.

**Migration.** A CI step that runs `os migrate plan`/`apply` against a project
whose config needs environment it was not given now fails instead of reporting
success over a fraction of the deployment. Supply that environment to the run
(the error names the missing variable), or fix the config.
