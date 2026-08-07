---
'@objectstack/objectql': patch
---

fix(objectql): the update-path `readonly` strip now drops the value the CALLER submitted, not whatever value the key holds when it runs

The static-`readonly` write strip runs after `beforeUpdate`, but decided what to
delete from a snapshot of the caller's KEY NAMES. Those are different facts the
moment a hook writes to a read-only column: `delete data[name]` took the hook's
value with it whenever the caller's payload happened to carry the same key.

Behaviour change — a whole-record write-back no longer erases hook writes. The
reported shape: a REST caller reads a record, flips `status` to `published`, and
PUTs the whole record back — `published_at: null` included, because that is what
it read. The publish hook stamped `published_at` on the transition; the strip
then deleted the stamp, and the row committed as `status = "published"` with
`published_at = null`, which every view sorting or filtering by `published_at` is
undefined on. The same hook's `last_reviewed_at` — equally read-only, but not
echoed by the caller — landed in that same write. Two hook-derived writes, one
alive and one dead, decided by nothing but a key name collision.

The entry snapshot now carries the caller's values, and a read-only key is
stripped only while it still holds the caller's own value. A key a hook
overwrote is a platform write and survives — the same verdict the runtime
already gave a read-only key a hook ADDS.

Not a relaxation of the read-only write rule: a caller-supplied read-only value
that no hook overwrote is dropped exactly as before, on both the single-id and
predicate update paths, and `isSystem` / `preserveAudit` are untouched. The
insert path is unchanged.

Known limit, by design: the snapshot is shallow, so a hook that mutates a
caller-supplied object or array IN PLACE is indistinguishable from a hook that
did nothing, and the field is still stripped. A hook that means to write a
read-only column should assign to it.
