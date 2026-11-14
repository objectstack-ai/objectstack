---
'@objectstack/driver-sql': patch
'@objectstack/runtime': patch
---

fix(driver-sql, runtime): a boot the organization-ownership guard refuses no longer drops a telemetry shard, and the refusal names a complete apply command

Clause-②: no
Metadata-protocol: none

**A refused boot drops no rotation shard.** The organization-ownership guard judges the database after the engine's schema sync has run. That sync also ran the Rotator for every object that declares `lifecycle.storage: { strategy: 'rotation' }` (`sys_activity` among them), and it DROPPED each shard older than the `shards × unit` window. So a database restored from a dump more than one window old lost those shards and their rows on the boot that then refused to serve it, before the ceremony that boot asked for had run. The same drop ran on every one-shot CLI boot, which arms no lifecycle sweep.

- FROM: `SqlDriver#initObjects` (schema sync) created the current shard, dropped the expired ones and rebuilt the read view over the rest.
- TO: schema sync creates the current shard and drops none. An expired shard stays in the read view, its columns synced with the rest. `SqlDriver#rotateShards`, the entry point the lifecycle sweep calls, is the only caller that drops expired shards. On a served boot the first sweep drops them, as before (`DEFAULT_LIFECYCLE_INITIAL_DELAY_MS` after start, or one sweep interval later when the store was swept within the interval). So a shard outlives its window by at most one sweep interval, the tolerance the sweep's own schedule already has.
- What to know: with lifecycle enforcement switched off (`OS_LIFECYCLE_DISABLED=1`, or `lifecycle: { enabled: false }` on the ObjectQL plugin) no sweep runs, so expired shards are no longer dropped at boot either and stay readable. Switch enforcement back on, or call the `lifecycle` service's `sweep()`, to drop them.

**The refusal's apply command is complete.** Every organization-ownership refusal now names the apply as `os migrate organization-ownership --apply --plan-file PLAN --backup-taken --out REPORT`, the same prefix as before (`--dev`, `--database-url`, the exported auth secret, the driver and token variables). Run without `--out`, the apply wrote its report into the directory it was run from.
