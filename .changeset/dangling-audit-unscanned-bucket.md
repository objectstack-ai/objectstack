---
"@objectstack/objectql": patch
---

fix(objectql): the dangling-reference audit names the objects a finite row
budget never reached, instead of dropping them (#5718)

`auditDanglingReferences` stops the moment `report.scanned >= maxRows`
(default 5 000). Every object behind that stop was never opened — and left no
trace in the report at all. Its `dangling: []` was indistinguishable from the
`dangling: []` of a table that really was read and really was clean, which is
the one reading this module is written to prevent: it already carries
`truncatedObjects` (the budget ran out INSIDE a table), `unreadableObjects`
(the datasource refused) and `aborted` (#4747, the run was called off), and the
module header says outright that together they are what stops `0 dangling` from
being read as `everything is fine`. Object-level budget exhaustion was the one
incompleteness path with no bucket of its own.

| Key | Means |
|:--|:--|
| `unscannedObjects: string[]` | objects this run never opened — the overall row budget was gone before their turn, or the run was called off first |

Notes on the shape:

- **Names, in scan order** (the `prioritise` tiers), so a caller can feed them
  straight back as `options.objects` to finish the picture on a second run.
- **Optional in the type, always set at runtime** — same contract as `aborted`
  and #4743's `provenance`: a hand-written report literal (a test double) still
  compiles, while every report this module produces states the key explicitly,
  `[]` included. `undefined` therefore never has to be guessed at; it can only
  mean "a report shape that predates the key", never "complete".
- **Two things are deliberately absent from it.** Objects with no reference
  field at all (nothing referential can break on them, so their silence is
  proven rather than assumed) and objects the caller excluded via
  `options.objects` (that is the caller's own narrowing, not the audit missing
  something).
- **It does not raise the summary warning on its own**, exactly like
  `truncatedObjects` and for the reason #4747 wrote down: a large database
  exhausts a finite budget on every healthy run, and an alarm that always fires
  trains its reader past the run that had a real finding. It rides itemised in
  the warning payload and is always in the returned report.

#4743 did not cause this — it made it easy to reach. Admitting the provenance
family means nearly every object now has an auditable field, so a bounded run
spreads the same budget over far more tables and hits the stop sooner. The
three-tier scan order that shipped with it decides WHO gets a finite budget;
this bucket reports who got none. Only the second one can make a bounded run
honest.
