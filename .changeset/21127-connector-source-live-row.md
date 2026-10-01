---
'@objectstack/spec': patch
---

fix(spec): a stack whose mapping authors `connectorSource` validates and lints again — the liveness ledger's `live` row no longer carries an author warning

Clause-②: no

`os validate` and `os lint` exited 1 on any stack with a `mappings[]` entry that
authored `connectorSource`, and the only output was the liveness lint's internal
error `ledger entry has unrecognised status "live"`. The ledger graded the key
`live` (the connector sync executor reads every key of the binding) and still
asked the lint to warn whoever authored it; the lint has no warning for a key
that works, and stops on that inconsistency by design. The row carries no warning
now, so both commands judge the stack and exit 0 when nothing else is wrong. The
runtime metadata door no longer returns an `authoring-rule-threw` advisory for
the same mapping.

The note the warning used to carry is on the key's description, where an author
reads it: a pull runs when a `job` drives it, nothing schedules one yet, so the
binding alone moves no rows. The retired `connector.syncConfig` prescription and
the `connector-sync-keys-retired` upgrade entry no longer say that authoring the
binding warns.

`check:liveness` now refuses a `live` ledger row with `authorWarn: true` at any
depth, and prints how many rows opt into an author warning on every run. A
`planned` row with `authorWarn` still warns. No key, value or default changed.
