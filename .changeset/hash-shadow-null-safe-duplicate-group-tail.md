---
"@objectstack/driver-sql": patch
---

The hash-shadow NULL-safe durability log now counts its overflow duplicate groups in the same words as the other three reports that render the same rows (#16289)

`formatDuplicateGroups` is module-local in `sql-driver.ts` for one stated reason, quoted from its own docblock: the sites that report a blocked unique "must name the SAME rows in the SAME shape, and a second hand-rolled `.slice(0, 5).join('; ')` is exactly how the plain and the NULL-safe path drifted apart in the first place". Four sites render duplicate groups — the drift entry, the direct arm's plain-unique log, the hash-shadow arm's plain-unique log, and the hash-shadow arm's NULL-safe branch — and the fourth still hand-rolled that exact shape.

So the drift the helper exists to prevent had already recurred, in the overflow tail: the helper writes `; …and N more group(s)`, the hand-rolled copy wrote `; …and N more`. Two durability logs about the same failure class, emitted from the same `catch`, disagreed on how they say "there are more".

What an operator sees: when a hash-shadow NULL-safe unique index is blocked by more than five conflicting groups in one table, the boot-time durability line now ends `; …and N more group(s).` instead of `; …and N more.`. The surrounding ` Conflicting group(s): ….` framing, the five groups rendered in full, their `(key) × N rows` spelling and their order are unchanged, and so is every other line. No behaviour, no data effect, no API movement — the five-then-count rendering is now owned in one place for all four sites.
