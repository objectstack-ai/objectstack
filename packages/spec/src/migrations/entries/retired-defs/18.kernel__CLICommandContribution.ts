// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12007 — kernel/cli-extension.zod.ts
// `CLICommandContributionSchema` / `CLICommandContribution`, retired whole
// (ADR-0049 enforce-or-remove; triage graded 2026-08-25, the exported
// orphan-value-schema class — #3950). The pair described a "CLI Command
// Contribution declaration in the manifest" and claimed retention "for
// describing command metadata in plugin manifests" — but after #10724
// tombstoned `manifest.contributes.commands`, no manifest surface could
// legally carry these entries: the exported schema advertised a shape whose
// only declared carrier rejects it. The manifest never referenced this schema
// even before the tombstone (its inline `commands` item schema was an
// independent duplicate). Zero consumers outside spec's own test and
// generated artifacts, measured at the retirement's base commit (146f448a5)
// with positive controls in objectstack, objectui (pinned sha) and cloud.
// What ACTUALLY registers CLI commands is oclif's native plugin discovery —
// `OclifPluginConfigSchema` (same module, live `package.json` `oclif`
// section) SURVIVES, as does the module docblock's Commander.js migration
// prose, which the `contributes.commands` tombstone cites. Route 3: no
// carrier key, no authored document for a D2 conversion to rewrite, so no
// tombstone and no conversion — this table plus the D3 semantic entry
// `cli-command-contribution-retired` ARE the declaration.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 / PR #8702 precedent).
export const entry = 'kernel/CLICommandContribution';
