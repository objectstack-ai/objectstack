// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-health-check-and-hot-reload-durations-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the three plugin-lifecycle durations whose unit lived in a source JSDoc only: '
    + 'PluginHealthCheck.interval, PluginHealthCheck.timeout and HotReloadConfig.debounceDelay '
    + '(kernel/plugin-lifecycle-advanced.zod.ts)',
  replacement: 'intervalMs, timeoutMs and debounceDelayMs — rename each key; all three values '
    + '(milliseconds) and their 30000 / 5000 / 1000 defaults are unchanged',
  reason:
    'Director-seat ruling A on #15939, 2026-09-11, carrying the maintainer\'s 「同意」 (decision '
    + 'batch #115), executing the #14478 rule per file. Each key named milliseconds in its JSDoc '
    + '— "Health check interval in milliseconds", "Timeout for health check in milliseconds", '
    + '"Debounce delay before reloading (milliseconds)" — and the JSDoc above a key is NOT what '
    + '`content/docs/references/**` renders; `.describe()` is. Measured on this tree by the '
    + 'gate\'s own census (check-duration-unit-keys --list): all three read [name: -] [prose: -] '
    + '— no unit in the name and none in the published prose either. `interval` is the sharpest '
    + 'of the three: its describe carried one unit-shaped token, the parenthetical '
    + '"(default: 30s)", which names SECONDS for a value the schema bounds and defaults in '
    + 'MILLISECONDS (min 1000, default 30000). That is the 1000x confusion the rule exists for, '
    + 'published to the one reader who cannot see the source. The suffix is the family\'s own '
    + 'spelling, counted on this tree: 100 key-position *Ms declarations across packages/spec, '
    + 'timeoutMs 29 of them and intervalMs 3, so both renames land on names the surface already '
    + 'uses. debounceDelay takes the plain suffix rather than a shortened form: it is the only '
    + 'debounce-shaped key spelling in the whole repo (5 key-position occurrences, all of this '
    + 'one key and its fixtures, no debounceMs variant anywhere), while the Delay-plus-Ms pairing '
    + 'is already attested (maxDelayMs, initialDelayMs, retryDelayMs, delayMs) — so unlike the '
    + 'Ttl-versus-TTL question the sibling round had to settle, there is no competing family '
    + 'spelling to choose between. All three old spellings are retiredKey() tombstones: neither '
    + 'PluginHealthCheckSchema nor HotReloadConfigSchema is .strict(), so a bare deletion would '
    + 'be a SILENT STRIP (#3733, ADR-0104) — and here the stripped value lands on a setInterval '
    + 'period, a race deadline and a setTimeout delay. Why a semantic entry and not a D2 '
    + 'conversion: the conversion chain walks a normalized STACK, and neither def is an '
    + 'authorable surface — no metadata-type binding, stack collection or manifest embed carries '
    + 'either, and both are library parameters a host passes to PluginHealthMonitor / '
    + 'HotReloadManager in TypeScript (the #4914 / #11825 keep) — so a conversion would be a '
    + 'transform with no seam that ever runs. That is the same disposition '
    + 'plugin-auto-restart-never-reinitialised and hot-reload-watch-placeholder-retired recorded '
    + 'for keys on these two defs. The registration-time refusals in '
    + 'PluginHealthMonitor.registerPlugin and HotReloadManager.registerPlugin are the door for '
    + 'the audience that does not parse. Measured on 884e8347d: the only in-repo readers are '
    + 'packages/core/src/health-monitor.ts and packages/core/src/hot-reload.ts, both moved in '
    + 'this same change; and the pinned objectui checkout — the pin this repo builds '
    + 'against, `.objectui-sha` = `53ded82bf7a494f54e344e19099dbf00854b8694` — names '
    + 'neither def and neither key: all thirteen exports of plugin-lifecycle-advanced.zod.ts and '
    + 'the string debounceDelay each occur 0 times across its 6409 tracked files, against lit '
    + 'controls objectstack 10171 and @objectstack/spec 3479 on the same corpus.',
  acceptanceCriteria:
    'Every producer and reader of a PluginHealthCheck spells intervalMs and timeoutMs, and every '
    + 'one of a HotReloadConfig spells debounceDelayMs — concretely '
    + 'packages/core/src/health-monitor.ts, whose loop now reads setInterval(..., '
    + 'config.intervalMs) and whose race reads config.timeoutMs, and '
    + 'packages/core/src/hot-reload.ts, whose debounce now reads config.debounceDelayMs. '
    + 'Authoring any old spelling fails to compile (input type `never`) and fails to parse with '
    + 'the rename prescription naming the suffixed key; handing one to registerPlugin on either '
    + 'class is refused with an ADR-0112 VALIDATION_ERROR / 400 before the plugin is stored. '
    + 'Behaviour is unchanged: the same milliseconds, the same 30000 / 5000 / 1000 defaults and '
    + 'the same min bounds (1000 / 100 / 0), and the published describes now name milliseconds. '
    + 'The sibling shutdownTimeout on HotReloadConfig is deliberately NOT renamed with them: its '
    + 'JSDoc reads "Graceful shutdown timeout" and names no unit anywhere, so it is the #14519 '
    + 'unit-nowhere shape the #14478 gate leaves outside its verdict, not part of this row set.',
};
