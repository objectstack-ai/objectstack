---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): consume the engine's bound `ctx.previous` and record one normalised view on both sides of the diff (#6656)

`plugin-audit` used to fetch its own pre-image. `captureBefore`, registered on
`beforeUpdate` / `beforeDelete`, issued a `ql.findOne` for the target row and
stashed it on `ctx.__previous`, because `HookContext.previous` was "officially
typed but not always populated by the engine itself". That is no longer true on
any path this plugin registers for, so the read is retired and the writer reads
the contract value.

**The read that goes away** (measured with a counting driver on the audited
object, `driver.findOne` per write):

| write | before | after |
|:--|--:|--:|
| single-id `update()` | 2 | 1 |
| single-id `delete()` | 2 | 1 |
| predicate `update()`, 3 matched rows | 3 | 0 |
| predicate `delete()`, 3 matched rows | 3 | 0 |

The predicate column is the larger half and was pure waste. #5574 binds
`input.id` on every per-row *before* context, which defeated the handler's own
`if (!id) return` bulk guard — so it read every matched row, and every result
was discarded, because `__previous` landed on the per-row *before* context while
the per-row *after* contexts (the ones the writer actually runs on) never saw
it. The engine's own matched-row read is untouched and still serves both phases,
so the ledger is unchanged.

**What the ledger records changes, and deliberately.** The two sides of an audit
diff came from two different pipelines: `before` through the engine's read path
(credentials masked, formulas hydrated, file references resolved) and `after`
from the raw write result. That asymmetry — not the redundant read — is why a
write that touched one field recorded phantom "changes" for every secret, file
and formula field on the record. Retiring the read makes both sides
same-source; the writer now also gives them one view, so the surface levels
upward rather than down to raw store contents:

- **Credential fields are masked on both sides.** Single-id delete `old_value`
  still reads `••••••••` for a `secret` field — that face is byte-identical.
  Change detection still runs on the raw values, so rotating a secret is still
  recorded as a change; only the recorded values are masked.
- **A pre-existing leak is closed.** The stored `secret:` ref was already
  reaching `sys_audit_log.new_value` on every create and update, and a
  `password` field — which ADR-0100 stores in cleartext at rest — was landing
  there **in plaintext**, in the audit ledger and in the `sys_activity` summary
  rendered in the record feed. Both now record the mask.
- **Computed fields leave the full snapshots.** `diff()` has always skipped
  them; create `new_value` and delete `old_value` never got the same rule, so
  they would have disagreed with each other once the pre-image stopped carrying
  hydrated formulas.

Two consequences worth naming, both narrowing single-id delete to what bulk
delete already did: its `old_value` now records a file field's stored id rather
than the resolved `{id, name, size, url}` object, and drops formula values. An
object whose label field is a formula falls back to the record id in the
`sys_activity` label on delete for the same reason.

No audit coverage is removed: the plugin keeps its `afterInsert` / `afterUpdate`
/ `afterDelete` registrations, which is what holds the engine's pre-image demand
gates open, and every one of them keeps the `excludeObjects` face from #5860.
