---
"@objectstack/objectql": patch
---

fix(objectql): decide the read-only strip on hook-write PROVENANCE, so a hook can clear a field the caller also sent (#14088)

`stripReadonlyFields` decided whether a `readonly` field's value came from a
before-phase hook or from the caller with `Object.is(payload[name],
supplied[name])`. Value equality cannot carry that question, and this is it
failing: when both sides hold the same value the comparison cannot separate
*the hook deliberately wrote it* from *the hook never touched it*, and the two
demand opposite verdicts. The hook's write was deleted along with the caller's.

**Measured downstream** (published 17.2.0, `duly_task`): a `readonly`
`completed_at` stamped by a `beforeUpdate` hook on the transition into `done`
and cleared on the transition out. Reopening a completed task works — unless
the caller also sends `completed_at: null`, which is exactly what a form
round-trip of the whole record does. `Object.is(null, null)` is `true`, the
hook's clear is stripped, and the row commits `status = in_progress` still
carrying its **old completion timestamp**, with no error. That row is the one
a validation rule structurally cannot catch ("a completed task must carry a
completion timestamp" has no purchase on its inverse), nothing downstream can
tell it from a genuinely completed one, and every on-time metric reading
`completed_at` counts it.

This is the second failure of one sentence, not a new defect. #5591 / #6339
retired the key-SET judgement because it made the strip's own written contract
— "hook-written keys are NOT caller-supplied" — true only *by accident*. Value
equality is accidental in precisely the same way; `null == null` is just its
most common collision.

**The repair is provenance, recorded rather than inferred.** A new
`recordHookPayloadWrites` view is armed over the update payload after the
caller's entry snapshot and sealed at the engine's post-hook confluence, where
`hookContext.input.data` is final on **both** update branches. It records only
the fact that an assignment executed — never the payload's contents — and
`stripReadonlyFields` now keeps a key a hook demonstrably assigned. Both
branches consume the one sealed record, so a bulk write and a by-id write can
never reach different verdicts about who wrote a key.

⛔ **Not a `null` special case.** `0`, `''`, `false` and a shared object
reference collide identically, and all of them are echoed back by the same
whole-record write-back idiom. A sentinel fix would have left every one of them
open.

⛔ **Not a relaxation of #2948 / #3003 / #5503.** A caller-supplied read-only
value that no hook wrote is still dropped, still warns with the same text, and
still reports through `onFieldsDropped` / `strictReadonlyWrites`. The
discriminator is pinned in both directions: the same caller payload
(`completed_at: null` over a stored timestamp) now **clears** when a hook wrote
the null and is still **stripped** when no hook did. A caller cannot enter the
record — echoing a key or a value is not an assignment — so no caller write can
become hook-owned.

**Known limit, deliberately fail-safe and pinned as a test.** A hook that
*replaces* the payload object (`ctx.input.data = { ...ctx.input.data, x: 1 }`)
rather than mutating it leaves no attributable record, and that call falls back
to the previous value comparison — i.e. it keeps the old over-strip. Reading a
replacement's keys as hook-owned would launder a caller's forged `created_by`
into a platform write, so the fallback direction is the only safe one. A hook
that means to own a read-only column should ASSIGN to it. The pre-existing
shallow-snapshot limit (a hook mutating a caller-supplied object *in place*) is
unchanged for the same reason.
