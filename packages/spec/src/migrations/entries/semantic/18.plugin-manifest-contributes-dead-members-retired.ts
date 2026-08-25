// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-contributes-dead-members-retired',
  surface:
    'manifest.contributes.events / manifest.contributes.menus / manifest.contributes.themes / '
    + 'manifest.contributes.translations / manifest.contributes.actions / '
    + 'manifest.contributes.drivers / manifest.contributes.fieldTypes / '
    + 'manifest.contributes.functions / manifest.contributes.commands (nine of the block\'s '
    + 'eleven members; `kinds` and `routes` are NOT part of this retirement)',
  replacement:
    'delete the keys — each capability already has its one enforced channel: `events` → '
    + "subscribe imperatively in plugin code (`ctx.hook('kernel:ready', …)` from `init`/`start`); "
    + '`menus` → the app `navigation` tree or `manifest.navigationContributions` (ADR-0029 D7); '
    + '`themes` → the stack-level `themes` metadata collection (an unrelated `ThemeSchema` '
    + 'surface); `translations` → the `translation` metadata type, authored with '
    + '`defineTranslationBundle` in `defineStack({ translations })`; `actions` → the stack '
    + '`actions` collection or `engine.registerAction`; `drivers` → register a kernel service '
    + 'named `driver.*` (objectql calls `registerDriver` on it); `fieldTypes` → nothing (no '
    + 'registration seam exists; the vocabulary is the spec `FieldType` enum); `functions` → '
    + '`defineStack({ functions })` → `engine.registerFunction`; `commands` → oclif native '
    + "plugin auto-discovery (an `oclif` section in the plugin's own `package.json`; see "
    + '`cli-extension.zod.ts`)',
  reason:
    'ADR-0049 enforce-or-remove; #10724 (triage graded 2026-08-21, cloud precondition '
    + 'discharged 2026-08-24). #10627 measured, monorepo-wide and non-test with control probes, '
    + 'that the ENTIRE monorepo contains exactly one read of `manifest.contributes` — '
    + '`packages/objectql/src/engine.ts`, member `kinds` — so all nine members above parsed, '
    + 'entered the manifest, and changed nothing. The census stands on three repos: objectstack '
    + '(re-verified on current main at claim time), objectui (0 property reads; control: 63 '
    + 'files carry the bare word), and cloud (measured clean 2026-08-24 at `5b5925a`: zero '
    + '`manifest.contributes` reads, controls held). Several members were actively misleading: '
    + '`events` was authored in-repo by a plugin that already subscribes imperatively; '
    + '`commands` documented Commander.js resolution the CLI dropped for oclif auto-discovery; '
    + '`fieldTypes` advertised a registration seam that has never existed. '
    + 'Why D3 semantic and not a D2 conversion: the conversion chain walks a normalized STACK '
    + 'and `PLURAL_TO_SINGULAR` has no `packages` / `plugins` entry, so a manifest is not a '
    + 'stack collection member and a conversion would be a transform with no seam that ever '
    + 'runs (the `kernel/Manifest:loading` precedent, recorded verbatim in its retired-key '
    + 'entry).',
  acceptanceCriteria:
    'No `objectstack.config.ts` manifest and no packaged `manifest.json` authors any of the '
    + 'nine members. The enforced channel is the one place a manifest is parsed with an author '
    + 'present: `os plugin build` runs `ManifestSchema.safeParse` and exits non-zero printing '
    + 'the per-key tombstone prescription; TypeScript authors fail earlier still (each key is '
    + 'typed `never`). `contributes.kinds` keeps parsing and registering '
    + '(`registry.registerKind`), and `contributes.routes` is untouched pending its own fork '
    + '(#10726). ⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read the nine members, so removing them removes no behaviour. A package '
    + 'ALREADY INSTALLED whose stored manifest carries one degrades to a single '
    + '`[metadata_spec_invalid]` log line at registration (the registry\'s `validate()` is a '
    + 'diagnostic, not a gate) rather than a boot failure; clear it by deleting the key from '
    + 'the source manifest and reinstalling.',
};
