---
"@objectstack/spec": patch
---

The liveness ledger's "Current state" table stops hand-maintaining its counts: the numbers
move into a generated `packages/spec/liveness/state-counts.md` carrying `merge=os-regen`,
and the eleven rows that had drifted from the gate are reconciled — each with the Notes
prose beside it re-read against the new measurement.

**Why it was a card and not a `sed`.** The table declares its own counting method (the
gate's `--json` report, fixed in #4488) and says the count columns are never hand-edited.
Nobody re-ran the snippet, and 9 of 30 rows disagreed with the gate by the time #7377 was
filed — two more (`job`, `translation`) joined when PR #7425 re-graded four docs-shaped
rows. Several Notes cells enumerate their own dead sets BY HAND, so regenerating the
numbers alone would have left a row reading `dead 6` next to a sentence naming four, which
is worse than the drift: the prose is the part a reader believes.

**Every delta is explained, not absorbed.** Six rows moved for one structural reason —
`field`, `action`, `hook`, `page`, `seed`, `webhook` picked up the ADR-0010 protection
envelope as the #4001 strictness campaign closed each schema (#4514/#4530/#4531/#4533/#4974),
and the gate auto-classifies those keys `live`. The rest are verdict-shaped: `flow`'s sixth
dead is `errorHandling.retryDelayMs`, tombstoned by the #4964 rename to `backoffMs`;
`view` gained three container-level keys in #4001 batch 6e (`object` live, `name`/`label`
dead) that its Note never mentioned; `app` gained `_unpublished` (#4829, a `live` key no
author may write) and its first `planned`, `navigation.runAction` (#4848); `action` gained
`description` (#7367); `job` and `translation` reached zero dead under #7425's ruling that
designer previews count as consumers.

**`job` is the first row in the table with zero dead where the ADR-0033 exemption is still
in force**, and the row now says so out loud: the keys are still docs-shaped, still
deliberately kept, still not `authorWarn`'d — what changed is that the measurement, not the
exemption, now carries the verdict.

**The split follows #5107.** Hand-maintained counts merge clean and WRONG: two PRs each move
a different row by their own correct delta, the rows do not overlap, and git composes a
table nobody wrote. The Notes prose stays hand-written in `README.md` — regenerating a Note
would manufacture a verdict, which that README calls worse than a missing row.
`check:liveness` gains three legs over the split (`scripts/liveness/readme-table.mts`,
unit-tested for the usual reason: on a green tree none of them can fire): the artifact must
equal what the gate measures right now, its row set and the README's must agree in both
directions, and a count column reappearing in the README fails — that last one is invisible
to the other two, and would let the table publish two sets of numbers with only one
enforced. `gen:liveness-counts` regenerates, spawning the gate rather than re-implementing
its walk, and keeps #7257's skeleton row for a governed type with no Note.
