---
'@objectstack/spec': patch
---

fix(spec): `record:activity`'s props row names `items` / `loading` as the host's feed slot when it refuses them

Clause-②: no

`ComponentPropsMap['record:activity']` (`RecordActivityProps`) refused an authored `properties.items` or `properties.loading` with only the generic "Unrecognized key(s) on this `record:activity`" line. Both are keys the objectui `record:activity` renderer reads, as a feed a host that composes the block in code already owns, so an author copying a TSX composition into a JSON page met no reason for the refusal.

- The refusal now says who reads each key on each mount the row reaches. On a standalone `record:activity`, `items` is the host's data channel and `loading` the host's fetch state for that feed. On a `record:chatter` / `record:discussion` `feed`, which is the same object, nothing reads either. The remedy is the same on both: omit them. The block then presents the record page's discussion feed, and a standalone `record:activity` with no discussion context fetches the record's own `sys_activity` rows. This is the same `guidance` shape `record:history`'s row already uses for `entries` / `loading`.
- The accept set does not change. Both keys stay refused, through the row and through `record:chatter` / `record:discussion`'s `feed`, which is the same object. Only the message text changes; `record:history` is unchanged.
