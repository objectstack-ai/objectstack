---
"@objectstack/driver-turso": patch
---

fix(driver-turso): escape the groupBy alias on the remote transport instead of gating it (#14235)

`RemoteTransport.aggregate` emits a caller-supplied output NAME in exactly two
positions. #14113 moved the aggregation alias to escaping and deliberately left
the groupBy alias (`GroupByNodeSchema.alias`, reaching the driver as
`g.alias ?? g.field`) on `assertSafeIdentifier`, because that position carried a
landed pin asserting the refusal. So a groupBy alias that was not a bare
`[A-Za-z_][A-Za-z0-9_]*` — `'Region Name'`, `'deal.stage_bucket'` — was refused
on this face while the in-memory, MongoDB and (post-#13714) SQL faces all
project it verbatim: one query, two answers, decided by a connection string.

The groupBy select site now emits `"<field>" AS <aliasIdentifierSql(outKey)>`,
the same quote-doubling escape the aggregation alias beside it already uses, so
both output-name positions of the method agree with `driver-sql`. The `field`
position keeps `assertSafeIdentifier` — a column REFERENCE is grammar and a
qualified one is legitimate, so it must be validated; an output NAME is one
name by definition and is quoted and escaped. `outKey === field` still emits the
alias-less `"<field>"`, byte-identical to before.

The #6401 pin that asserted the refusal is rewritten in place, on the same
input, to assert what the transport now emits — the recorded, non-silent
reversal the card asked for rather than a rider on someone else's change. The
escaped alias is pinned against a real SQLite-backed libsql stub as well as on
the captured statement, because only executing it tells "escaped" apart from
"broke out".

No accept set moves at the contract: `GroupByNodeSchema.alias` already declares
this key and the spec already admits these names. What moves is this driver's
accept set, toward the contract the other three faces already implement —
declared = enforced, restored. The refusal envelope for the positions that stay
gated (#14287, `INVALID_REQUEST` / 400) is untouched.
