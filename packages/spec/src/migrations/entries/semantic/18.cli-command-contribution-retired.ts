// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cli-command-contribution-retired',
  surface:
    'kernel.cliCommandContribution (the orphan exported schema of '
    + '`cli-extension.zod.ts` — 1 def, 2 exported names: '
    + '`CLICommandContributionSchema` / `CLICommandContribution`)',
  replacement:
    '(removed — there is no declarative replacement, because no declarative '
    + 'surface ever carried it. CLI commands are registered through oclif\'s '
    + 'native plugin discovery: the plugin package declares an `oclif` '
    + 'section in its own `package.json` — `OclifPluginConfigSchema` in the '
    + 'same module describes that live surface and SURVIVES, as does the '
    + 'module docblock\'s Commander.js migration record, which the '
    + '`manifest.contributes.commands` tombstone cites)',
  reason:
    'ADR-0049 enforce-or-remove; #12007, the exported orphan-value-schema '
    + 'class (#3950: an exported schema with no consumer reads as a '
    + 'capability). The schema described a "CLI Command Contribution '
    + 'declaration in the manifest" and claimed retention "for describing '
    + 'command metadata in plugin manifests" — but after #10724 tombstoned '
    + '`manifest.contributes.commands` (protocol 17), no manifest surface '
    + 'could legally carry these entries: the export advertised a shape whose '
    + 'only declared carrier rejects it. The manifest never referenced this '
    + 'schema even before the tombstone — its inline `commands` item schema '
    + 'was an independent duplicate. Zero consumers outside spec\'s own test '
    + 'and generated artifacts, measured at the retirement\'s base commit '
    + '(146f448a5) with positive controls in objectstack, objectui (pinned '
    + 'sha) and cloud. With no carrier key and no authored document there is '
    + 'nothing to tombstone and no seam for a D2 conversion: route 3, the '
    + '#11825 / #8715 shape — RETIRED_DEFS_BY_MAJOR plus this entry ARE the '
    + 'declaration.',
  acceptanceCriteria:
    'No code imports `CLICommandContributionSchema` or '
    + '`CLICommandContribution` from `@objectstack/spec` or '
    + '`@objectstack/spec/kernel` — both are TS2305 after upgrade, on every '
    + 'public entry (pinned by resolved symbol identity in '
    + '`kernel/cli-command-contribution-retirement.test.ts`). No metadata '
    + 'document needs editing: the def was reachable from no metadata-type '
    + 'binding, stack collection or manifest embed — the only surface that '
    + 'ever claimed to carry command contributions '
    + '(`manifest.contributes.commands`) already rejects the key with the '
    + '#10724 prescription, which is unchanged by this retirement. '
    + '`OclifPluginConfigSchema` / `OclifPluginConfig` survive on `./kernel` '
    + '(same pin). ⚠️ Runtime behaviour is deliberately UNCHANGED: the CLI '
    + 'never resolved commands from this declaration — commands are '
    + 'oclif-auto-discovered, before and after.',
};
