---
"@objectstack/driver-mongodb": minor
---

feat(driver-mongodb): index `lookup` joins off the canonical `reference` key (#13222)

`syncCollectionSchema`'s field-level join-index arm gated on `field.reference_to`.
That is a REJECTED ALIAS — `FieldSchema` answers `unrecognized_keys` for it on any
field type — and this driver's own schema door refuses it outright. So the arm's
`lookup` conjunct could not be satisfied by any input at all, and no authored
lookup had ever been indexed on MongoDB. The arm now reads `reference`, the only
relationship spelling the spec declares.

Measured as a complete case split over the key's value domain rather than a
sample: every `reference_to` value except `undefined` is refused at the door, and
`undefined` is falsy, so the old conjunct was unreachable for every possible
input. The `user` disjunct was unaffected and is why the feature looked healthy —
it needs no relationship key, so `idx_owner_lookup`-shaped indexes were always
created.

The refusal door itself is unchanged: predicate, `VALIDATION_ERROR`/400 envelope,
placement and instruction are all as they were. Only the tail of its message
moved, because it told the reader that renaming the key would not by itself get
the field an index — true when written, false now.

A `lookup` that declares no `reference` is still not indexed. Measured on
`FieldSchema`: `{ type: 'lookup' }` and `{ type: 'lookup', reference: '' }` both
parse successfully — the spec's prose calls `reference` required for these types
but the schema does not enforce it — so this is a real authorable shape, and an
index for a join with no declared target would cost every write and buy no read.
`master_detail` and `tree` are unchanged: they reach this arm on neither spelling.

## ⚠️ OPERATORS — this changes boot behaviour on existing deployments

**What it costs.** The first `syncSchema` after this upgrade CREATES these
indexes on collections that already hold data. Each one is an awaited
`createIndex`: a full collection scan plus an external sort of the extracted
keys, followed by permanent index storage and a small write amplification on
every subsequent insert/update of the indexed field. ("Awaited" describes the
driver, not the server — see the build-feature note below for what the server
does during it.) Later boots are free —
`createIndex` is idempotent for an index that already exists, and this driver
already relies on that.

⚠️ **The builds are SERIALIZED, so the times ADD.** `syncCollectionSchema` awaits
`createIndex` once per index in a sequential loop, and `syncSchemasBatch` awaits
`syncSchema` once per object the same way. Startup is extended by the SUM of
every build, not by the slowest one. This is the figure to plan the maintenance
window around.

**How much.** Measured on this tree: **65 lookup fields carrying `reference`
across the 52 exported platform objects** — every one gains an index, and this is
the floor, not the total. Add the objects of any enabled plugin (`plugin-security`
14 lookup fields, `plugin-approvals` 13, `plugin-audit` 6, `plugin-sharing` 4) and
one index per lookup field on your own authored objects.

Per index, as an order-of-magnitude planning figure and **not** a benchmark — get
your own numbers before sizing a window, because they depend entirely on document
count, storage and cache:

| collection size | build time, one index | index storage added |
|---|---|---|
| empty / a few thousand docs | effectively instant (metadata-only) | negligible |
| ~1M docs | seconds | tens of MB |
| ~10M docs | ~a minute | hundreds of MB |
| ~100M docs | tens of minutes | a few GB |

Most `sys_*` collections are small and will finish instantly. Budget for the ones
that accumulate: `sys_metadata_history`, `sys_metadata_audit`, `sys_notification`,
`sys_email`, `sys_session`, and any audit-log object. Count them first
(`db.<collection>.estimatedDocumentCount()`) and multiply by the lookup fields
each carries; watch a live boot with `db.currentOp()`.

**Build feature — hybrid builds, unconditionally.** `@objectstack/driver-mongodb`
depends on `mongodb@^7.5.0`, whose own compatibility statement is "the driver
currently supports 4.2+ servers". MongoDB 4.2 is exactly the release that made
index builds hybrid, so **every server version this driver can connect to builds
these indexes with the hybrid builder**: an exclusive lock is taken only briefly
at the start and end of each build, and the collection accepts reads AND writes
throughout the rest of it. This is not a full write stall. Two caveats that
remain: the brief exclusive lock at each end is real, and on a replica set the
build runs on every member.

**To take the cost outside the boot window,** create the indexes ahead of the
upgrade, with the names and specs the driver uses — `{ name: 'idx_FIELD_lookup' }`
over `{ FIELD: 1 }`, no `unique` and no `sparse`. The driver's `createIndex` is
then a no-op and startup is unaffected. Matching the options matters: a
pre-existing index of the same name with different options raises
`IndexOptionsConflict`, which this driver deliberately swallows and skips, leaving
your index in place unchanged.
