---
"@objectstack/objectql": patch
---

fix(objectql): retire `sys_fetch_previous_delete`, so `delete()`'s per-object prior-row gate is a real question (#5929)

`delete()` reads the doomed row's pre-image only when something on **this
object** consumes it — a delete-side hook in either phase, or a roll-up summary
aggregating it. That gate has been per object since #5272, and on a
kernel-hosted engine it was **constant true for every object that has ever
existed**, so the skip it exists to perform never happened outside the unit
tests' bare engines.

The reason was `ObjectQLPlugin`'s own builtin. `sys_fetch_previous_delete`
registered on `beforeDelete` with `object: '*'`, which made the gate's first
term true everywhere — and it could not use what it held open: since #5272 (and
#6697, which extended the same ordering to the predicate path, per matched row)
the engine reads the pre-image and binds `previous` **before** `beforeDelete`
dispatches, so the builtin's own `if (input.id && !ctx.previous)` guard was
permanently false and it issued no read. Its only remaining effect was holding
open the gate that made it redundant. Retired under ADR-0049
enforce-or-remove.

**What changes for you, in both directions:**

- An object with **no** delete-side hook and no roll-up summary now performs
  **no prior-row read** on a by-id `delete()`. Previously it always did, on any
  kernel.
- Where a delete-side hook **does** exist, `previous` still arrives bound,
  identically — from the engine's own read, which was already the only producer.
  Hook handlers, declarative `condition`s reading `previous`, the record-change
  trigger, the audit diff and the summary recompute are all unaffected.
- The residual shape the retired guard could still have been true for — the
  engine's read found nothing because the row is already gone — is one where the
  builtin's read found nothing either, so it binds nothing there too. `previous`
  stays **unbound** rather than fabricated as `{}`, unchanged (#4649/#4775).

Nothing about hook dispatch, the by-id repoint re-resolution, or the delete
dispatch ladder changes. The gate's three terms are unchanged — what changed is
that its first term now reflects **real** hooks.

One caveat worth stating so nobody reads a skip into a trace that will not show
one: a kernel that also loads plugin-auth, plugin-sharing or service-storage
still has the gate held open on every object, because each registers a
delete-phase hook with no `object` and decides applicability inside its handler.
Those are real consumers, not circular ones. plugin-audit is the exception and
the worked example — it narrows at the engine face with `excludeObjects`
(#5860), so an excluded object really does skip the read. The full enumeration
is in `engine.ts` beside `wantsPreImage`.
