---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

`lifecycle.ttl` now accepts an `onlyWhen` row filter mirroring `retention.onlyWhen`, and the shared `onlyWhen` value union gains the platform's canonical null predicate `{$null: boolean}` (on both blocks). A `transient` object that interleaves live rows with terminal audit tombstones can now spare rows defined by a value's absence — e.g. `ttl: { field: 'expires_at', expireAfter: '1d', onlyWhen: { revoked_at: { $null: true } } }` — instead of the TTL reaping backdated tombstones first. The LifecycleService Reaper passes `ttl.onlyWhen` into the same reap scope `retention.onlyWhen` already rides; declaring `ttl.onlyWhen` together with rotation storage or archive is refused at parse time, mirroring retention's guards.
