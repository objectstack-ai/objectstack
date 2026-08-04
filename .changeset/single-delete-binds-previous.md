---
"@objectstack/objectql": patch
---

fix(objectql): a single-record `delete()` binds `hookContext.previous` — the pre-image the contract has always promised (#5272)

`HookContext.previous` is documented in the spec as *"the state of the record
BEFORE the operation (**for update/delete**)"*, and `update()` has bound it all
along. `delete()` never did. `previous` was `undefined` in **both**
`beforeDelete` and `afterDelete`, for every single-record delete, on every
object.

That is not a cosmetic gap. Since #4775 a condition that cannot be evaluated
**fails the operation**, so a legal, contract-shaped delete-side hook:

```ts
{ events: ['afterDelete'], condition: "previous.status == 'done'" }
```

rejected *every* single-record delete of that object — and reported it through
the generic branch (`Unknown variable: previous`), which reads like the author
misspelled a key. The key was fine; the engine never bound it. Same shape as
#5037: a platform gap surfacing as the author's mistake.

**Why now.** #5038 made a predicate bulk delete dispatch `afterDelete` once per
matched row, each carrying that row's own pre-image. The single-record path
still bound nothing, so it became strictly *worse* than the bulk path — the
exact inversion the #4800/#4862 ruling ("an author writes the hook once; single
and bulk mean the same thing") exists to prevent.

**What changed.** `delete()` now takes the doomed row's pre-image once, before
`beforeDelete` fires, and binds it to `hookContext.previous` for both phases —
so hook `condition`s, record-change flow triggers and delete-audit handlers all
see the deleted row. The read is demand-driven, exactly like `update()`'s: it
happens only when the object has a delete-side hook (either phase) or a roll-up
summary aggregating it. An object with neither pays nothing, and an object with
both phases pays **one** read, not two — the roll-up path's own separate
pre-image fetch has been folded into this one, and is now the same raw driver
read `update()` already feeds the summary recompute.

Nothing is fabricated: if the row is not there, `previous` stays **unbound**
rather than becoming `{}`/`null`, so a condition reading it still faults loudly
instead of answering for a record nobody read (#4649/#4775). The batch dispatch
of a predicate delete still carries no `previous` — it stands for N rows — and
its per-row `afterDelete` contexts are unchanged.

Upgrade impact: a delete-side hook whose `condition` reads `previous` starts
evaluating instead of rejecting the write, and delete-side handlers start
receiving `ctx.previous`. If you worked around the gap by testing
`ctx.previous == null` to detect "this is a delete", that test now answers
differently — read `ctx.event` instead.
