// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-dead-containers-retired',
  surface:
    'manifest.capabilities / manifest.configuration / manifest.extensions (three top-level '
    + 'containers; retiring the container settles every key beneath it — '
    + '`capabilities.{implements,provides,requires,extensionPoints,extensions}` and '
    + '`configuration.{title,properties}` — at once)',
  replacement:
    'delete the keys — each declared purpose either has its one enforced channel or never '
    + 'existed: `configuration` (a `{ title, properties }` settings surface no UI rendered '
    + 'and no loader resolved) → pass options to the plugin\'s constructor in '
    + '`defineStack({ plugins: [new MyPlugin({ … })] })`, the channel hosts already use; '
    + '`capabilities` (protocol/interface declarations sold as "interoperability and '
    + 'automatic discovery") → nothing — no discovery path ever existed; real dependency '
    + 'resolution runs off top-level `manifest.dependencies`, which stays; `extensions` (an '
    + 'untyped `z.record(z.string(), z.unknown())` catch-all) → the enforced extension '
    + 'channels: `contributes.kinds` registers metadata kinds, `navigationContributions` '
    + '(ADR-0029 D7) injects navigation, and code-level extension lives in the plugin itself '
    + '(`init`/`start`)',
  reason:
    'ADR-0049 enforce-or-remove; #11332 (triage graded 2026-08-23, cloud precondition '
    + 'discharged 2026-08-29 on #12400). #11332 measured, monorepo-wide and non-test with '
    + 'control probes, ZERO reads of each container itself, which settles all eight keys '
    + 'beneath them — a key cannot be read if the object holding it never is. The census '
    + 'stands on three repos: objectstack (re-verified on current main at claim time; every '
    + 'bare `.capabilities` hit classifies to a different surface — driver loader contracts, '
    + 'the QuickJS sandbox argument set, REST discovery, the ADR-0066 stack-level '
    + '`capabilities` collection), objectui (0 container reads; control: `manifest.(id|name|'
    + 'namespace|version)` reads findable), and cloud (measured clean 2026-08-29 at '
    + '`15f55df`: zero reads of all three, controls positive). '
    + '`configuration.properties.secret` made this false compliance rather than tidying: its '
    + 'describe() promised "value is encrypted/masked (e.g. API Keys)" and nothing ever '
    + 'encrypted, masked or parsed it, so the key\'s own text was an unkept assurance about '
    + 'credential handling. '
    + 'Why D3 semantic and not a D2 conversion: the conversion chain walks a normalized '
    + 'STACK and `PLURAL_TO_SINGULAR` has no `packages` / `plugins` entry (re-verified — its '
    + '`capabilities` entry is the unrelated ADR-0066 stack collection), so a manifest is '
    + 'not a stack collection member and a conversion would be a transform with no seam that '
    + 'ever runs (the `kernel/Manifest:loading` precedent, recorded verbatim in its '
    + 'retired-key entry). `PluginCapabilityManifestSchema` stays published: the '
    + 'plugin-registry surface (`plugin-registry.zod.ts`) still declares it, so this is a '
    + 'carrier-key tombstone with no def removal.',
  acceptanceCriteria:
    'No `objectstack.config.ts` manifest and no packaged `manifest.json` authors any of the '
    + 'three containers (the two in-repo authors — driver-memory and plugin-hono-server, '
    + 'both writing `configuration` and `capabilities` blocks nothing read — were cleaned '
    + 'with this retirement). The enforced channel is the one place a manifest is parsed '
    + 'with an author present: `os plugin build` runs `ManifestSchema.safeParse` and exits '
    + 'non-zero printing the per-key tombstone prescription; TypeScript authors fail earlier '
    + 'still (each key is typed `never`). Live neighbours are untouched and must be verified '
    + 'as such: `manifest.dependencies` keeps resolving dependencies, `contributes.kinds` '
    + 'keeps registering, `navigationContributions` keeps merging. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED: nothing ever read the three containers, so removing them '
    + 'removes no behaviour. A package ALREADY INSTALLED whose stored manifest carries one '
    + 'degrades to a single `[metadata_spec_invalid]` log line at registration (the '
    + 'registry\'s `validate()` is a diagnostic, not a gate) rather than a boot failure; '
    + 'clear it by deleting the key from the source manifest and reinstalling.',
};
