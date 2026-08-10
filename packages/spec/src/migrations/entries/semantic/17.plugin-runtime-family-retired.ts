// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-runtime-family-retired',
  surface:
    'kernel.dynamicLoadRequest / kernel.dynamicUnloadRequest / kernel.dynamicPluginResult '
    + '/ kernel.pluginSource / kernel.dynamicPluginOperation',
  replacement:
    '(removed — there is no replacement shape, because there is no operation to describe. '
    + 'Plugins are composed at boot: `defineStack` registers them and the kernel runs '
    + 'register → init → start; the set is fixed until the process restarts. Delete the '
    + 'import and the value. Runtime plugin loading, if it is ever built, returns via the '
    + 'enforce route of ADR-0049 through a new ADR — loader first, vocabulary second)',
  reason:
    'The five schemas declared the "Dynamic Loading" capability — runtime load / unload / '
    + 'reload of plugins without a kernel restart, with sandboxing, integrity hashes, '
    + 'drain strategies and dependent-cascade policy — and NOTHING implemented it. A '
    + 'bare-name scan of objectstack, cloud and objectui found zero references outside '
    + "this package's own declaration, its unit tests and the generated artifacts: no "
    + 'runtime ever received a `DynamicLoadRequest`, performed a load/unload, or produced '
    + 'a `DynamicPluginResult`. That is the ADR-0049 false-compliance shape at its most '
    + 'inviting to an AI author (ADR-0033), who reads `DynamicLoadRequestSchema` in the '
    + 'published IDE bundle as proof the platform hot-loads plugins and constructs a '
    + 'request that parses clean and is received by nobody (#3950: an exported schema '
    + 'with no consumer is read as a capability). The #3896 follow-up removed this '
    + "module's discovery/sandbox config island and left these five in place explicitly — "
    + '"operation contracts, not security promises; the enforce-or-remove call on them is '
    + 'a design decision rather than a correction" — but that suspension lived only in a '
    + 'changeset paragraph with no issue carrying it. #4834 is that decision, answered '
    + 'REMOVE. `experimental` was considered and rejected: it is only `.describe()` prose '
    + 'and cannot stop an import, the weakest of the three ADR-0049 channels. None of the '
    + 'five is stored metadata — they are root request/result payload shapes embedded in '
    + 'no parent schema and parsed against no metadata document — so no `sys_metadata` '
    + 'row can carry one and there is no source for the D2 chain to rewrite; this entry '
    + 'is the D3 record. The removal also subsumes the kernel half of '
    + '`plugin-activation-events-retired` (#4657): that tombstone goes with the shape '
    + 'that carried it. ADR-0049, #4834.',
  acceptanceCriteria:
    'No code imports `DynamicLoadRequestSchema`, `DynamicUnloadRequestSchema`, '
    + '`DynamicPluginResultSchema`, `PluginSourceSchema`, `DynamicPluginOperationSchema` '
    + 'or any of their type aliases (`DynamicLoadRequest`, `DynamicUnloadRequest`, '
    + '`DynamicPluginResult`, `PluginSource`, `DynamicPluginOperation`, '
    + '`DynamicLoadRequestInput`, `DynamicUnloadRequestInput`) from '
    + '`@objectstack/spec` or `@objectstack/spec/kernel` — every one is TS2305 after '
    + 'upgrade, on every public entry (pinned by symbol identity in '
    + '`plugin-runtime-retirement.test.ts`). Nothing regresses at runtime, because '
    + 'nothing called anything: a caller that believed it was hot-loading a plugin was '
    + 'already only building an object. Boot-time composition through `defineStack` is '
    + 'unchanged.',
};
