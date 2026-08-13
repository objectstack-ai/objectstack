---
"@objectstack/driver-turso": patch
---

fix(driver-turso): a remote upsert that lands a NULL record number now says so (#7099)

#6944 made the Turso REMOTE face refuse an `auto_number` write it cannot fulfil
instead of silently writing NULL, but one leg was left uncovered and declared as
known residue: an `upsert` carrying an `id` or explicit `conflictKeys` that
matches nothing still inserts, and the record-number slot still lands NULL. The
refusal is raised deliberately BEFORE the statement is built — that is what makes
a refused write cost zero round trips — and whether an `INSERT … ON CONFLICT`
merges or inserts is not knowable at that point.

That outcome is UNCHANGED here. What changes is that it is no longer silent:

```
upsert({ id: 'never-seen', … })  ->  RESOLVED case_number=null   (before: nothing said)
                                     + logger.warn naming the object,
                                       the column and the row id  (now)
```

The residue was recorded under the premise that detecting this leg would cost
"the round trip this refusal exists to avoid". Measured, that round trip is
already paid unconditionally: `RemoteTransport.upsert` follows its
`INSERT … ON CONFLICT` with `SELECT * FROM "<object>" WHERE "id" = ?` and returns
the mapped row. So the NULL was in hand all along, one field read away, on the
layer that knows which column is an `auto_number` — and the leg is made loud
without buying anything and without a probe query.

Scope, stated because it is deliberately narrow:

- **No accept/reject change.** The same writes are accepted and refused as
  before, and the returned row is byte-identical. Refusing after the write has
  landed is a different act from the pre-write gate, and it is untouched.
- **Not a generator.** Issuing record numbers on the remote transport remains
  deferred (#6944 disposition A).
- **Reported at `warn`, not `error`.** Everything the caller submitted persisted
  and the returned row carries the `null` in plain sight; what is missing is a
  derived value this face declares it does not issue. Per AGENTS.md
  §Degradation log levels that is a functional degradation, not a durability one.
- **Not throttled.** Unlike the tenant-audit warning it sits beside, the row `id`
  IS the payload — one line per unnumbered row is the list an operator repairs.

Operators of remote Turso deployments carrying `auto_number` objects will see a
new `warn` line on this path. It reports a condition that was already happening
silently; no behaviour changed to produce it.
