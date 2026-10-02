---
'@objectstack/spec': patch
---

fix(spec): `record:activity`'s props row names `items` / `loading` as the host's feed slot when it refuses them

Clause-②: no

`ComponentPropsMap['record:activity']` (`RecordActivityProps`) refused an authored `properties.items` or `properties.loading` with only the generic "Unrecognized key(s) on this `record:activity`" line. Both are keys the objectui renderer reads, as a feed a host that composes the block in code already owns, so an author copying a TSX composition into a JSON page met no reason for the refusal.

- The refusal now names `items` as the host's data channel and `loading` as the host's fetch state for that feed, with the remedy: omit them. With no host `items` the block presents the record page's discussion feed, or fetches the record's own `sys_activity` rows. This is the same shape `record:history`'s row already uses for `entries` / `loading`.
- The accept set does not change. Both keys stay refused, through the row and through `record:chatter` / `record:discussion`'s `feed`, which is the same object. Only the message text changes; `record:history` is unchanged.
