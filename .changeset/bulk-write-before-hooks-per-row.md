---
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

feat(objectql): dispatch `before*` hooks per matched row on a predicate bulk write (#5574, #5846)

A `multi: true` update or delete now dispatches `beforeUpdate` / `beforeDelete`
**once per matched row**, on a single-record-shaped context carrying that row's
`id` and `previous` — the same move #5038 made for the `after*` phase, held to
the same yardstick. ADR-0058 Addendum II (maintainer ruling B, 2026-08-06) is
the contract; `packages/spec/src/data/bulk-write-hook-conformance.ts` states it
as clauses D1–D7, and its `delivered` flags flip with this change.

**The harm this fixes.** `ctx.previous` was never bound in the before phase of a
predicate write, so every guard written the way guards are written —
`if (ctx.previous?.locked) throw` — passed **silently** on every batch. The
failure direction is fail-OPEN and the optional chaining that makes it silent is
exactly what an AI writes. One measured deployment had all 15 of its guard hooks
bypassed by a single batch edit, including writing `null` into a `readonly: true`
field that the single-id path refuses.

**Two visible behaviour changes, both loud.**

- **Guards now fire per row on predicate writes.** A `beforeUpdate` /
  `beforeDelete` hook on an object targeted by a `multi: true` write runs N times
  instead of once, each time with that row's `previous` bound. Zero matched rows
  is zero dispatches. A hook that throws refuses the whole batch before anything
  is written. The payload stays **batch-scoped** (D3): every per-row context
  carries the one payload, so a rewrite applies to every matched row whichever
  row's dispatch made it, rewrites accumulate in dispatch order, and no predicate
  write is ever split into N single-row writes — one `updateMany`, one affected
  count (#4639), one aggregate event. A rewrite *conditioned* on the row is
  therefore out of contract: it widens to the whole batch rather than scoping
  itself. Per-row `previous` is supplied so a guard can REFUSE, not so a rewrite
  can be aimed.
- **The `input.id` reroute lever is retired and now refuses.** The dispatch
  ladder is resolved **before** the before phase — it has to be, since per-row
  contexts are built from the matched row set — so the id slot can no longer
  steer the write. Rather than ignore an assignment (a silent no-op) or honour
  it blindly, the write is rejected with `HookTargetRebindError`
  (`ERR_HOOK_TARGET_REBIND`), whose message names the retired capability and the
  three supported replacements. Recorded as ADR-0058 Amendment II.1. Precisely:

  | | CLEARED id | REBOUND to another id |
  |---|---|---|
  | `update()` by-id | refused | refused |
  | `delete()` by-id | refused | **honoured, unchanged** (#5272's re-read) |
  | either, per-row | refused (D4) | refused (D4) |

  Clearing is uniform because it worked by falling through to the predicate
  branch, and that branch is now chosen before any handler runs. Rebinding is
  not uniform, deliberately: the case against honouring it is that the write
  lands on a row whose pre-image and rules were never evaluated, and on
  `delete()` that is simply not true — #5272 already re-resolves the new target
  before `afterDelete` or the summary recompute sees it. `update()` has no such
  mechanism and building one would be the "silently pick re-resolution instead"
  the ruling forbids. Retiring the delete-side repoint is its own question,
  filed as #6752 rather than ridden in on an ordering change.

**Also in this change.**

- **One read, reused (D7).** The matched row set is read ONCE per predicate
  write, with the write's own composed AST, and serves per-row validation
  (#3106), the `readonlyWhen` strip (#3042) and both per-row dispatches.
- **One ceiling, both phases (D6).** `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000) now
  governs `before*` as well as `after*`, checked **before the first dispatch**, so
  an over-ceiling batch runs zero handlers and writes nothing — a refusal, never
  a downgrade to one dispatch. The engine's open-coded ceiling and refusal
  message are replaced by the spec module's `resolveBulkPerRowHookBudget`, so the
  number and the wording have one definition again.
- **`update()` binds `previous` before the before phase (#5846 (a)).** The by-id
  path reads its prior row ahead of the dispatch, matching `delete()`'s shape
  since #5272, so both phases share one read. objectql's
  `sys_fetch_previous_update` builtin is **retired**: it existed to bind
  `previous` for the before phase behind `if (input.id && !ctx.previous)`, and
  that guard is now permanently false. A by-id update on a kernel used to read
  the same row three times; this removes one and makes the engine's read the
  single producer.
- **`HookConditionLimitation` is retired** (ADR-0049 enforce-or-remove), with
  `isPredicateBulkWrite` and the `predicateBulkWrite` flag. Both members
  (`bulk_write_previous_unbound`, `bulk_write_stored_state_unavailable`)
  described a batch-scoped `before*` dispatch that no longer exists, leaving them
  with neither producer nor reachable consumer. A `previous`-reading `before*`
  condition on a bulk write now **evaluates as authored**, per row, instead of
  rejecting the batch. `HookConditionError` itself is unchanged — an unevaluable
  condition still aborts the operation (#4775).

**Migrating.** A handler that cleared `ctx.input.id` — or rebound it on an
`update()` — must instead write through `ctx.api` / `ctx.ql` for the row it
means, have the caller pass `{ multi: true, where: … }`, or throw to refuse the
write. A `beforeDelete` handler that repoints the target is unaffected. A `beforeUpdate` hook
with side effects on an object that receives bulk writes should expect to run
per row; a batch-wide effect belongs in a payload rewrite, which is still
batch-scoped.
