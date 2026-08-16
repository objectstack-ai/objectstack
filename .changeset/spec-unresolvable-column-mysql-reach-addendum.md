---
"@objectstack/spec": patch
---

docs(spec): the `driver-sql-unresolvable-where-column-refused` ledger entry states MySQL's reach as it is after #8926, not as it was at registration (#9060)

Text amendment to an already-registered ADR-0087 entry — the entry id, `surface`
and `replacement` prescription are unchanged, and no accept/reject behaviour
moves. What changes is the `reason`, which is upgrader-facing documentation: it
is the data source for `objectstack migrate meta`, `spec-changes.json` and the
generated upgrade guide.

The entry's "Reach, stated rather than assumed" paragraph said MySQL was outside
the refusal — true when #8790 registered it, false the moment #8926 merged (PR
#9061). A MySQL user reading "on MySQL this condition still travels out as the
raw dialect error" would have concluded the migration did not apply to them,
which is exactly wrong after parity.

The historical paragraph is kept verbatim as the state at registration, and a
dated addendum states both halves of what the one shared predicate did on MySQL:

- **The envelope** — an unresolvable WHERE column refuses with the same
  `INVALID_FILTER` / 400 naming the column, instead of the raw
  `ER_BAD_FIELD_ERROR` with the statement's bound literals inlined.
- **The recoveries** — MySQL also gained the #3821 projection and ORDER-BY
  recoveries it never had, so those positions now return recovered rows where
  they used to throw.

Both arrive together because `ER_BAD_FIELD_ERROR` spells every clause position
with one sentence, so all three ride one arm of the predicate — pinned as the
ruled direction by the widened sweep in
`sql-driver-unresolvable-where-column-refusal.test.ts`. Unchanged by that
ruling, and said so in the addendum: a dotted filter key is still classified per
dialect, the axis #8371 owns.
