// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-manifest-loading-retired',
  surface:
    'manifest.loading (the whole block: strategy / preload / codeSplitting / dynamicImport / '
    + 'initialization / dependencyResolution / hotReload / caching / sandboxing / monitoring)',
  replacement:
    'nothing to re-declare — delete the key. Plugins are composed at boot: `defineStack` '
    + 'registers them and the kernel runs `init` then `start` in an order topologically '
    + "resolved from each composed plugin's own `dependencies` / `optionalDependencies` "
    + '(`resolvePluginOrder` in `packages/core/src/plugin-order.ts`). For the isolation '
    + '`loading.sandboxing` appeared to configure, use the plugin trust tier '
    + '(`manifest.runtime`, ADR-0025 §3.6) and the manifest permission declarations, which '
    + 'are the surfaces the platform actually enforces',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-04 on #4914. The block declared a '
    + 'complete plugin loading policy and NOTHING read it. A bare-name scan of all three '
    + 'repos — objectstack, cloud (measured 2026-08-09) and objectui (measured at pickup), '
    + 'each with a control probe proving the scan saw the tree — put every hit inside '
    + '`packages/spec` itself: this module\'s own declaration, its own unit tests, the '
    + '`Manifest.loading` embed and the generated artifacts. `manifest.loading.*` had zero '
    + 'readers in `packages/core`, `packages/runtime` and `packages/metadata`. So the key '
    + 'parsed, entered the manifest, and changed nothing — #3950, at the scale of a whole '
    + 'block. What made it outrank ordinary inert-key cleanup is `sandboxing`: it declared '
    + 'process / vm / iframe / web-worker isolation, IPC transports and an `allowedServices` '
    + 'ACL, so an AI author (ADR-0033) reading that vocabulary concluded the platform '
    + 'isolates plugins, wrote the config, and received a clean parse and zero isolation. An '
    + 'inert security control is worse than an absent one because it is believed. Hot reload '
    + 'was additionally a TWO-SOURCE defect: the docs pointed at this dead '
    + '`PluginHotReloadSchema` while the only implementation body, `HotReloadManager` '
    + '(`packages/core/src/hot-reload.ts`), reads a different vocabulary — '
    + '`HotReloadConfigSchema` in `plugin-lifecycle-advanced.zod.ts`. Ruling §2 converges on '
    + 'the surviving side: that schema is KEPT as the starting point for a future enforce '
    + 'decision (it has an implementation body but no runtime composes it yet), and '
    + 'enforcing it is deliberately a separate decision, not this retirement. '
    + 'Why D3 semantic and not a D2 conversion: the chain walks a normalized STACK and '
    + '`applyConversionsToStoredItem` maps a metadata type onto one of its collections. A '
    + 'package manifest is neither — `PLURAL_TO_SINGULAR` has no `packages` / `plugins` '
    + 'entry, so a manifest is not a stack collection member and a stored manifest row '
    + 'passes that seam through unchanged. A conversion would be a transform with no seam '
    + 'that ever runs.',
  acceptanceCriteria:
    'No `objectstack.plugin.json` and no stored package manifest carries a `loading` key. '
    + 'The enforced channel is the one place a manifest is parsed with an author present: '
    + '`os plugin build` runs `ManifestSchema.safeParse` and exits non-zero, printing the '
    + 'tombstone prescription, so a manifest still declaring `loading` fails its build '
    + 'rather than shipping. TypeScript authors get it earlier still — `loading` is typed '
    + '`never`, so assigning it is a `tsc` error. ⚠️ Runtime behaviour is deliberately '
    + 'UNCHANGED and must be verified as such: nothing ever read the block, so removing it '
    + 'removes no behaviour. A package ALREADY INSTALLED whose stored manifest carries '
    + '`loading` keeps working — the registry\'s `validate()` is an explicit diagnostic and '
    + 'not a gate (it catches, logs `[metadata_spec_invalid]`, and registers the item '
    + 'anyway, deliberately, so bad metadata is never a data outage), so such a row '
    + 'degrades to one log line at registration rather than a boot failure. Clear it by '
    + 'deleting the key from the source manifest and reinstalling.',
};
