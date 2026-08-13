---
"@objectstack/spec": major
"@objectstack/objectql": patch
---

refactor(spec)!: remove the never-implemented `upsert` flag from `engine.update()`'s option surface (#8057, ADR-0049 enforce-or-remove)

`options.upsert` was declared on both update-options schemas
(`EngineUpdateOptionsSchema` and the deprecated `DataEngineUpdateOptionsSchema`)
and sat on the engine's update allowlist, yet **no engine or driver path ever
read it**: it was not a driver pass-through key and `ObjectQL.update()` never
referenced it. A caller passing `{ upsert: true }` got silence — not a refusal,
not an upsert. The one place a caller would learn the truth was by reading the
engine, and the strict-unknown gate (the mechanism that normally catches a
meaningless option) actively vouched for the key.

FROM → TO: delete `upsert` from any `engine.update()` / `updateData` option
bag. For create-if-absent intent, express it explicitly — read the row first
(`findOne`) and call `insert` or `update` on what you find. Note the by-id
update branch now throws `RECORD_NOT_FOUND` when the id names no row (#7867's
not-found gate); a future first-class upsert must reconcile with that gate by
design, which is why the flag is removed rather than implemented.

The retirement kit:

- `retiredKey()` tombstones on BOTH schemas, one shared prescription
  (`ENGINE_UPDATE_UPSERT_REMOVED`): authoring the key is a tsc error and a
  parse error carrying the fix.
- The objectql engine drops `upsert` from `ENGINE_UPDATE_OPTION_KEYS` and
  quotes the same prescription from its unknown-option gate
  (`ENGINE_RETIRED_OPTION_MESSAGES`), so the untyped runtime path is loud too.
- **ADR-0087 registry**: both keys registered in `RETIRED_KEYS_BY_MAJOR[17]`
  plus the D3 semantic entry `engine-update-upsert-retired`. **No D2
  conversion**, deliberately: an engine option bag is call-time only — nobody
  authors one and nothing persists one (the `BatchOptions.validateOnly`
  disposition).
- Baselines (`authorable-surface/data.json` `[RETIRED]` marks,
  `authorable-defaults`, `api-surface`, `spec-changes.json`, upgrade guide,
  reference docs) regenerated deliberately.

No runtime behaviour changes for any in-tree caller — zero production call
sites passed the flag (measured in #8057); the only references were the spec's
own schema tests, now re-pointed to assert the refusal.
