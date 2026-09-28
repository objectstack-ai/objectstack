---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `diffMetaItem`'s default range labels its to side with the active row's own version, so `GET /meta/:type/:name/diff` with no `from` / `to` names the versions it compares while a draft is pending (#20397)

With no `toVersion`, the to side is the current active `sys_metadata` row. Its body was compared, but `toVersion` came from the newest `sys_metadata_history` row, which is a draft save whenever a draft is pending: every draft save appends a history row. The labels and the bodies then named different rows. Measured on the real REST stack, an app with one active save and two draft saves answered `fromVersion 2 → toVersion 3` over its version-1 body, and a view with one active save and one draft save answered "no changes" labelled `1 → 2` while version 2 differs.

- **Now:** `toVersion` is the active row's own `version`, read in the same read as its body. The default `fromVersion` rule is not changed by this entry (#20451, in the same release, then moves it to the nearest earlier version whose body differs from the to side's). An item whose active row is version 2 with a draft pending answers `1 → 2`, the same answer as `?from=1&to=2`.
- **No active row** (a draft-only item, or a deleted one): the to side is absent, and both labels are `null` with empty buckets, as the response schema declares for an absent side. Before, a draft-only item was labelled with its newest draft save, and its from side could be an earlier draft save's body. A deleted item was labelled `N-1 → N` up to its tombstone. That deletion is still read by naming its versions (`?from=N-1&to=N`).
- Unchanged: the response shape, explicit `from` / `to` ranges, and the default range of an item with no draft pending.
