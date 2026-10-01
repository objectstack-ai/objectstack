---
'@objectstack/driver-turso': minor
'@objectstack/driver-sql': patch
---

feat(driver-turso): the remote transport issues `auto_number` values (#21113)

Clause-②: yes (widening)

A `create()`, `bulkCreate()` or `upsert()` on the Turso REMOTE transport that
leaves an `autonumber` field empty (`undefined`, `null` or `''`) now gets a
generated value. It used to be refused with `NOT_IMPLEMENTED` / 501, so on a
hosted tenant database — which is on this transport — no object declaring an
`auto_number` field could get a new record at all. Nothing is declared anew in
the spec or in the package exports; `supports.autonumber` stays `true` and is
now honoured.

- The value comes from the same persistent `_objectstack_sequences` counter the
  local and embedded-replica transports use, rendered by the same format rules
  (`autonumberFormat` / `format`, organization scope, date and `{field}`
  tokens), bootstrapped from the table's highest existing value by the same
  reading, and re-seeded the same way after rows land above the counter by a
  seed replay or import. A remote driver and an embedded replica of one
  database draw from one counter row.
- The counter moves in one statement over the connection (`UPDATE … RETURNING`,
  or on a cold counter `INSERT … ON CONFLICT (key_hash) DO UPDATE … RETURNING`),
  so writers in different processes never draw the same number.
- An `upsert()` that merges into an existing row keeps the number already in
  the row; a row that carries its own number is written unchanged.
- A `_objectstack_sequences` table in the pre-`key_hash` shape is refused in
  remote mode with `DATABASE_ERROR` / 500 and the remedy in the message (open
  the database once through the local or embedded-replica transport, which
  migrates it); remote mode does not migrate it and does not key by the legacy
  rule.
- `RemoteTransport.upsert()` takes an optional fifth argument naming columns
  that are written on insert and left alone on merge.

`@objectstack/driver-sql`: the sequence rules a second transport shares are
now `protected` members of `SqlDriver` (`resolveSequenceTenantId`,
`defineSequencesTable`, `maxAutonumberCounter`, `escapeLikePrefix`,
`sequencesTableName`, `autoNumberCollisionRetries`). No export is added and no
behaviour changes on any dialect.
