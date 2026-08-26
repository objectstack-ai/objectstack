---
"@objectstack/spec": minor
---

feat(spec): retire the orphan `CLICommandContributionSchema` export — the manifest surface it described is a tombstone (#12007, ADR-0049)

<!-- adr-0087: registered cli-command-contribution-retired -->

**BREAKING** export removal, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18 — `RETIRED_DEFS_BY_MAJOR[18]`
(`kernel/CLICommandContribution`) + the D3 semantic entry
`cli-command-contribution-retired` — where `os migrate meta` users will
look).

`CLICommandContributionSchema` described a "CLI Command Contribution
declaration in the manifest" and claimed to be "retained for backward
compatibility and for describing command metadata in plugin manifests" — but
after #10724 tombstoned `manifest.contributes.commands`, no manifest surface
could legally carry these entries: the exported schema advertised a shape
whose only declared carrier rejects it. The manifest never referenced this
schema even before the tombstone (its inline `commands` item schema was an
independent duplicate), and it had zero consumers outside spec's own test and
generated artifacts, measured at the retirement's base commit with positive
controls in objectstack, objectui (pinned sha) and cloud — the exported
orphan-value-schema class (#3950: an exported schema with no consumer reads
as a capability).

FROM → TO:

- `CLICommandContributionSchema` / `CLICommandContribution` → *(removed — no
  declarative replacement, because no declarative surface ever carried it)*.
  CLI commands are registered through oclif's native plugin discovery: the
  plugin package declares an `oclif` section in its own `package.json` —
  `OclifPluginConfigSchema` / `OclifPluginConfig` (same module) describe that
  live surface and survive unchanged.

One-line fix: delete the import (nothing ever read the declaration); if you
describe a plugin's CLI commands, declare the `oclif` section in the plugin's
`package.json` — `OclifPluginConfigSchema` validates it.

The retirement kit:

- whole-def deletion (route 3 — no carrier key, no authored document, so no
  tombstone and no D2 conversion; the #11825 / #8715 shape):
  `kernel/CLICommandContribution` in `RETIRED_DEFS_BY_MAJOR[18]`, plus the D3
  semantic entry `cli-command-contribution-retired`
- pin test (`kernel/cli-command-contribution-retirement.test.ts`): zero
  holders for both retired names on every public entry, survivors pinned
  (`OclifPluginConfigSchema` / `OclifPluginConfig` — the live `package.json`
  `oclif` surface)
- the module docblock's Commander.js migration prose is KEPT — it is cited by
  the `contributes.commands` tombstone (full-file deletion was explicitly not
  the shape)
- zero authored occurrences in objectstack, objectui or cloud (measured at
  dispatch, re-verified at claim), so no in-repo source changes ride along
