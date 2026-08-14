---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the metadata read path no longer serves stored cleartext credentials (#8154)

`decorateMetadataItem` returned the whole stored body, so a `datasource` row
written before #8078 closed the write door came back with `config.password` in
cleartext — and the password embedded in `config.url` alongside it — from
`GET /api/v1/meta/datasources`, from the single-item read, and from the layered
read in **both** its `overlay` and `effective` layers. PR #8126 closed the
datasource-admin door (`GET /api/v1/datasources/:name`); this closes the
platform door one over. Meta read permission is granted at a far lower bar than
"may see the production database password", which is what made this reachable.

The fix consumes the per-type redactor registry #8300 landed in
`@objectstack/spec/kernel` (`getMetadataTypeRedactor`) rather than redacting
`datasource` specifically: `datasource` is that registry's first consumer, and a
type-shaped patch here would be the narrow fix that leaves the next
secret-bearing type exposed. A plugin whose metadata type stores secrets gets
the same protection by calling `registerMetadataTypeRedactor` — no change here.

Three properties worth knowing, each measured rather than assumed:

- **`_diagnostics` are still computed on the RAW stored body, before
  redaction.** The redacted body is exactly the shape the post-#8078 schema
  accepts, so computing them afterwards flips `valid:false` to `valid:true` on
  precisely the rows that hold a stored credential — which would delete the
  operator's only inventory of what still needs migrating (#8081 item 3). The
  two steps are composed inside one function so no call site can invert an
  ordering it cannot see.
- **The stored record is never mutated, and the connect path is untouched.**
  Redaction is a serving act; datasource connection and boot-time restore read
  `sys_metadata` directly through the data engine, not through these exits.
- **The write path carries the credential forward**, and this half is not
  optional: `saveMetaItem` accepts a redacted body and persists the credential
  away, so a read scrub shipped alone would convert today's loud `422` into
  **silent credential deletion** on an ordinary GET → edit → PUT round trip.
  `config.url` makes it unavoidable rather than a masking choice — a
  URL-embedded password is schema-accepted, so dropping it round-trips to
  deletion and masking it round-trips to storing the mask as the literal
  password. Stored material is re-applied only where the incoming body is
  indistinguishable from what the read served; anything the author actually
  wrote wins and is still judged by #8078's write gate on its own merits. This
  also restores the #4326 byte-identical round-trip invariant, which
  read-redaction alone would have broken.

It preserves cleartext already at rest and creates none; moving stored
credentials into `sys_secret` is #8081 item 3's migration and is deliberately
not attempted on a write door an author drove.
