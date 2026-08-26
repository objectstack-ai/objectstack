// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'hot-reload-watch-placeholder-retired',
  surface:
    '`HotReloadConfig.watchPatterns`, and the `HotReloadManager.startWatching` '
    + 'placeholder that read it',
  replacement:
    'Run your own watcher and call '
    + '`HotReloadManager.scheduleReload(pluginName, reloadFn)` when a file '
    + 'changes — that is the debounced integration point this class actually '
    + 'implements, and it is unchanged. Declare your globs wherever your '
    + 'watcher reads them; there is no in-tree replacement for the key, '
    + 'because file watching is the HOST\'s job in this host-driven library. '
    + 'The platform already depends on `chokidar` in `@objectstack/metadata`, '
    + '`@objectstack/metadata-fs` and `@objectstack/cli` — never in '
    + '`@objectstack/core` — so a host has a working model to copy.',
  reason:
    'ADR-0049 enforce-or-remove, applied one symbol over from #12340 in the '
    + 'same file and on the same per-key test. `HotReloadManager.startWatching` '
    + 'contained NO watcher: its whole body was a guard plus '
    + "`logger.info('File watching started', { patterns })` above an in-source "
    + 'note saying real watching "would require chokidar or similar / This is a '
    + 'placeholder for the integration point". `watchHandles` was only ever '
    + 'read, deleted, iterated and cleared and NEVER set, so `stopWatching`\'s '
    + 'cleanup branch and the teardown loop over its keys were structurally '
    + 'UNREACHABLE rather than merely untaken (measured with a firing positive '
    + 'control: `reloadTimers.set` resolves a real writer in the same file and '
    + 'the same scan; `watchHandles.set` resolves nothing anywhere). So '
    + '`watchPatterns` had no reader that ACTED on it — its only two uses were '
    + 'log lines — and an author could declare a glob while no file change '
    + 'could ever trigger a reload. This is the #3950 shape with the volume '
    + 'turned up: #12340\'s inert fallback at least announced itself at DEBUG, '
    + 'whereas this said "File watching started" at INFO — positive '
    + 'confirmation of a capability that did not exist, which an operator, or '
    + 'an AI author (ADR-0033), reads as proof and stops looking. Neither of '
    + 'the other two ADR-0049 states was available: ENFORCE would build for a '
    + 'caller that does not exist (no runtime composes `HotReloadManager` — '
    + 'only its own unit test and `core/examples/phase2-integration.ts` '
    + 'construct it, the same fact that decided #12340\'s route), and '
    + 'EXPERIMENTAL requires a roadmap, where a scan of every planning doc '
    + 'returned ZERO mentions of hot-reload file watching against 145 control '
    + 'hits in the same files. Route 3 again: `HotReloadConfig` is not an '
    + 'authorable surface — no metadata-type binding, stack collection or '
    + 'manifest embed ever carried it, and nothing in the tree parses '
    + '`HotReloadConfigSchema` outside its own unit test — so there is no '
    + 'authored document to rewrite and nobody who could receive a parse-time '
    + 'prescription, so there is no D2 conversion either — it would be a '
    + 'transform with no seam that ever runs. The key is TOMBSTONED rather '
    + 'than deleted, and the BUILD is what decided that: the plain deletion '
    + 'was tried first and `gen:schema` gate (a) refused it, because '
    + '`HotReloadConfigSchema` is not `.strict()` and a bare deletion would '
    + 'be a silent strip (#3733, ADR-0104) — the very defect being retired, '
    + 'one layer down. #12340 could take route 3 because what left there was '
    + 'a whole DEF; a key leaving a SURVIVING def has no such exit. This '
    + 'entry IS the declaration.',
  acceptanceCriteria:
    'No host passes `watchPatterns` to `HotReloadManager.registerPlugin`, and '
    + 'no host calls `HotReloadManager.startWatching`. TypeScript hosts cannot '
    + 'do either: `watchPatterns` is typed `never` by the tombstone, and '
    + '`startWatching` returns `never`. JavaScript hosts, and config that '
    + 'arrived as JSON, get a loud refusal carrying the prescription — an '
    + 'ADR-0112 envelope (`code: VALIDATION_ERROR`, `status: 400`), thrown for '
    + 'a leftover `watchPatterns` BEFORE the `enabled` check so a disabled '
    + 'config cannot smuggle the false declaration through, and thrown '
    + 'unconditionally from `startWatching` so the placeholder can no longer '
    + 'report success. `startWatching` is kept as a throwing door rather than '
    + 'deleted precisely so that caller meets a prescription instead of a bare '
    + '`TypeError: not a function`. Runtime reload behaviour is UNCHANGED for '
    + 'every config that worked: nothing was ever watched, so nothing that '
    + 'used to happen stops happening — `registerPlugin`, `scheduleReload`, '
    + '`reloadPlugin` and state preservation are untouched, and '
    + '`stopWatching` keeps the half that always did something (it cancels a '
    + 'pending debounced reload; its unreachable `watchHandles` branch left '
    + 'with the placeholder). The #11825 keep still stands: '
    + '`HotReloadConfigSchema` and `PluginStateSnapshotSchema` still export '
    + 'from `./kernel`, and `HotReloadManager` / `PluginHealthMonitor` still '
    + 'export from `@objectstack/core` with their tests green.',
};
