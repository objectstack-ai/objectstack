---
"@objectstack/spec": minor
"@objectstack/core": minor
---

fix(spec,core): `HotReloadConfig.stateStrategy` refuses the two values it never implemented; `distributedConfig` retired (#12340, ADR-0049)

<!-- adr-0087: registered hot-reload-inert-state-strategies-retired -->

**BREAKING** accept-set narrowing + export removal, landing after the v17.0.0
cut (the lockstep launch-window convention ships it as `minor`; the
prescription is registered under protocol major 18 —
`RETIRED_DEFS_BY_MAJOR[18]` + the D3 semantic entry
`hot-reload-inert-state-strategies-retired` — where `os migrate meta` users
will look).

This is ADR-0049 applied one level INSIDE the library the 2026-08-25 #11825
ruling deliberately kept. That ruling retired the authorable lifecycle-config
container and kept `HotReloadConfigSchema` as a host-driven library parameter
type; this change measures the kept vocabulary's own remainder and finds the
same defect in it. The keep itself stands — `HotReloadConfigSchema`,
`PluginStateSnapshotSchema` and the health vocabularies still export, and
`HotReloadManager` / `PluginHealthMonitor` are untouched.

The `'disk'` and `'distributed'` arms of `PluginStateManager.saveState` both
wrote to the SAME in-memory `Map` as `'memory'` — the in-source comments said
"memory fallback" — and announced the substitution at DEBUG level only. A host
that asked for durable or cluster-replicated state got process-local memory
and no error: state that does not survive the restart it was configured to
survive. `distributedConfig` had ZERO readers anywhere, so an author could
name a Redis endpoint, a TTL and a replication factor and nothing ever opened
a connection.

FROM → TO:

- `stateStrategy: 'disk'` → `stateStrategy: 'memory'` — byte-identical runtime
  behaviour, because `'disk'` already stored to memory. It is the spelling
  that was false, not the behaviour.
- `stateStrategy: 'distributed'` → `stateStrategy: 'memory'` — same, or
  `'none'` to disable state preservation outright.
- `distributedConfig: { … }` → *(removed)* — delete the key. It left with the
  `'distributed'` value its own doc comment called it "required" for.
- `DistributedStateConfigSchema` / `DistributedStateConfig` /
  `DistributedStateConfigParsed` → *(removed)* — the orphan value schema of
  that one key.

One-line fix: replace `'disk'` or `'distributed'` with `'memory'` and delete
any `distributedConfig` — you were already getting in-memory state. There is
no in-tree replacement for durable or distributed plugin state; persist it in
the host, which owns the process lifetime these strategies pretended to
outlive. Real disk or distributed persistence returns only via the ENFORCE
route of ADR-0049 — the implementation first, the declaration with it.

The retirement kit:

- **enum-value narrowing** (`['memory','disk','distributed','none']` →
  `['memory','none']`): invisible to all four ratchets by construction (the
  def still emits), so the prescription hangs on the enum's own `error` map
  dispatched by `issue.input` — the `crypto.hash` / `managedBy: 'system'`
  precedent. A value that was never legal still gets zod's own enum message,
  so a typo is not told it "was removed".
- **whole-def deletion** (route 3 — `HotReloadConfig` is not an authorable
  surface: no metadata-type binding, stack collection or manifest embed ever
  carried it, and nothing in the tree parses `HotReloadConfigSchema` outside
  its own unit test, so there is no authored document to rewrite and nobody
  who could receive a parse-time tombstone): `kernel/DistributedStateConfig`
  in `RETIRED_DEFS_BY_MAJOR[18]` plus the D3 semantic entry. Ratchets moved as
  a def removal must — `api-surface` −3, `authorable-surface` −8,
  `json-schema.manifest` −1.
- **runtime doors** in `@objectstack/core`, because route 3 leaves no
  parse-time prescription: `HotReloadManager.registerPlugin` now refuses an
  unhonoured `stateStrategy` and a leftover `distributedConfig` with an
  ADR-0112 envelope (`code: VALIDATION_ERROR`, `status: 400`) carrying the
  prescription. Refused BEFORE the `enabled` check, so a disabled config
  cannot smuggle the false declaration through. TypeScript hosts never reach
  it — `HotReloadConfigParsed['stateStrategy']` is now `'memory' | 'none'`, a
  compile error at the call site.
- **pin move, declared**: `DistributedStateConfigSchema` was NAMED in the
  #11825 survivor list, so this reverses one line of that ruling on new
  evidence — #11825 measured the container's six groups, never this key's own
  readers. The pin in `kernel/plugin-lifecycle-advanced-retirement.test.ts`
  moves in the same commit with the reasoning recorded beside it, and asserts
  the surrounding keep is intact.
- zero in-tree consumers passed `'disk'` or `'distributed'` (measured at
  cdbd9204b6 with a firing positive control; every live caller passes
  `'memory'` or `'none'`), so no in-repo source changes ride along.
