---
"@objectstack/spec": minor
"@objectstack/core": minor
---

fix(spec,core): `HotReloadManager.startWatching` refuses instead of reporting success; `HotReloadConfig.watchPatterns` retired (#12428, ADR-0049)

<!-- adr-0087: registered hot-reload-watch-placeholder-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18 — `RETIRED_KEYS_BY_MAJOR[18]` + the D3 semantic entry
`hot-reload-watch-placeholder-retired` — where `os migrate meta` users will
look). Graded `minor` rather than `major` for the same reason #12340 was one
day earlier, in this same module.

ADR-0049 applied one symbol over from #12340, in the same file and on the same
per-key test. The #11825 keep still stands: `HotReloadConfigSchema` and
`PluginStateSnapshotSchema` still export, and `HotReloadManager` /
`PluginHealthMonitor` are untouched apart from the two doors below.

`HotReloadManager.startWatching` contained **no watcher**. Its whole body was a
guard plus `logger.info('File watching started', { patterns })`, above an
in-source note saying real watching "would require chokidar or similar". Where
#12340's inert fallback at least announced itself at DEBUG, this claimed
success at **INFO**: an operator who set `enabled: true` with `watchPatterns`
and read that line had been told the opposite of the truth. `watchHandles` was
only ever read, deleted, iterated and cleared and **never set**, so
`stopWatching`'s cleanup branch and the teardown loop over its keys were
structurally unreachable rather than merely untaken. `watchPatterns` therefore
had no reader that acted on it — its only two uses were log lines.

FROM → TO:

- `watchPatterns: ['src/**/*.ts']` → *(removed)* — delete the key. Declare your
  globs wherever your own watcher reads them.
- `manager.startWatching(name)` → `manager.scheduleReload(name, reloadFn)`,
  called from your own watcher's change handler. That is the debounced
  integration point this class does implement, and it is unchanged.

One-line fix: delete `watchPatterns`, and call `scheduleReload` from your own
file watcher instead of `startWatching` — nothing was ever watched, so nothing
that used to happen stops happening. File watching is the host's job in this
host-driven library; `chokidar` is already a dependency of
`@objectstack/metadata`, `@objectstack/metadata-fs` and `@objectstack/cli` —
never of `@objectstack/core` — so a host has a working model to copy.

The retirement kit:

- **key tombstone**, and the build is what chose it: the plain deletion was
  tried first and `gen:schema` gate (a) refused it, because
  `HotReloadConfigSchema` is not `.strict()` and a bare deletion would be a
  silent strip (#3733, ADR-0104) — the very defect being retired, one layer
  down. #12340 could take route 3 because what left there was a whole *def*; a
  key leaving a *surviving* def has no such exit. So `watchPatterns` is
  `retiredKey()`-tombstoned, its surface line carries `[RETIRED]`, and
  `kernel/HotReloadConfig:watchPatterns` is registered by exact key in
  `RETIRED_KEYS_BY_MAJOR[18]`. A key tombstone on a surviving def moves
  `authorable-surface` only — the def still emits, so `api-surface` and
  `json-schema.manifest` do not.
- **no D2 conversion**, deliberately: the chain walks a normalized stack, and
  `HotReloadConfig` is not an authorable surface — no metadata-type binding,
  stack collection or manifest embed ever carried it — so a conversion would be
  a transform with no seam that ever runs. For the same reason the prescription
  carries no `os migrate meta` sentence, exactly as its `stateStrategy` sibling
  in this module does not.
- **runtime doors** in `@objectstack/core`, because nothing in the tree parses
  `HotReloadConfigSchema` outside its own unit test, so the tombstone alone
  reaches nobody: `startWatching` now throws an ADR-0112 envelope
  (`code: VALIDATION_ERROR`, `status: 400`) carrying the prescription, and
  `registerPlugin` refuses a leftover `watchPatterns` the same way — before the
  `enabled` check, so a disabled config cannot smuggle the false declaration
  through. `startWatching` is kept as a throwing door rather than deleted so
  that caller meets a prescription instead of a bare `TypeError`.
- **dead code removed with a firing positive control**: `watchHandles` and both
  of its unreachable readers are gone. The zero was pinned first —
  `reloadTimers.set` resolves a real writer in the same file and the same scan,
  while `watchHandles.set` resolves nothing anywhere. `stopWatching` keeps the
  half that always did something (it cancels a pending debounced reload), and
  `shutdown` is unchanged in effect: the loop it lost iterated `watchHandles`
  and therefore ran zero times.
- **ENFORCE and EXPERIMENTAL were both unavailable**, which is why this is a
  removal: no runtime composes `HotReloadManager`, so enforcing would build for
  a caller that does not exist; and a scan of every planning doc returned zero
  mentions of hot-reload file watching against 145 control hits in the same
  files, so there is no roadmap for `experimental` to point at.
