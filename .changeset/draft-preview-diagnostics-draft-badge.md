---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a draft preview no longer reports itself invalid because of its own `_draft` badge (#7656)

`GET /api/v1/meta/<type>/<name>?preview=draft` answered with `_diagnostics.valid:
false` and *"Unrecognized key(s) on this object: `_draft`"* for drafts that were
perfectly valid — the read stamped `_draft:true` onto the item so the console
could badge it, then validated the item **with that key still on it** against a
closed schema. The verdict was about the reader, not the document, and it reached
both exits: the single-item preview read and the draft overlay in the list.

`computeMetadataDiagnostics` now removes every key on the shared
`METADATA_READ_DECORATIONS` list before its re-parse, instead of the private
one-key copy it carried (which removed `_diagnostics` only, and predated `_draft`
joining that list). That list exists precisely so the read path's own annotations
cannot be mistaken for document content by anything that re-parses a served
document — the write path's verbatim persist (#4326) and the cold-boot flow bind
(cloud#971) are the other two consumers; read-time diagnostics are the third.

The item schema is **unchanged and still closed**: `_draft` remains rejected by
name when it appears in a stored body, which is what keeps the write-path strip
load-bearing. Only the reader stopped feeding its own badge to it.

Genuinely invalid drafts are unaffected — they still read back `valid:false` with
their own errors, on both exits.
