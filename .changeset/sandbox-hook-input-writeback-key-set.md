---
"@objectstack/runtime": patch
---

fix(runtime): the sandbox hook write-back carries the keys the body wrote, not every key it could see

A sandboxed `before*` hook body's mutations were written back onto the engine's
payload with `Object.assign(target, mutatedInput)`, where `mutatedInput` is the
whole post-run `ctx.input` — every key the body could see, touched or not. That
target is the engine's flat-input Proxy, and every assignment through it is
recorded by the hook-write provenance recorder. So the write-back was reporting
that a body which touched nothing had written every payload key.

The per-row divergence refusal that ends "one hook-mutated payload applied to
every matched row" on a `multi: true` update reads exactly that recording: per
row, the key set the hook chain assigned, refusing the batch when two rows
disagree. All rows share ONE payload, so the noise was order-dependent — with a
transition stamp bound to `beforeUpdate`, one open row and one already-completed
row:

- already-done row dispatched first: the windows differ, the batch is refused;
- open row dispatched first: the already-done row inherits `completed_at` from
  the transitioning row's write onto the shared payload, the blanket write-back
  re-asserts it as that row's own write, the windows match — and the refusal
  abstains, moving a `completed_at` on a record that never transitioned.

The refusal was therefore true for in-process handlers and, in one of two driver
row orders, silently untrue for shipped hook bodies. The QuickJS runner now arms
a write recorder on `ctx.input` for hook bodies — the same recorder shape
`ctx.record` has used since the discarded-record-write report — and the
write-back re-asserts only the keys the body assigned, defined or deleted.

Nothing else about the channel moves:

- deletion still propagates, unchanged. It was never expressed by the merge:
  the write-back reads it from the entry snapshot as absence-from-the-dump,
  before both merges, and a key the body never touched is present in the dump
  and so is never deleted.
- a write made THROUGH a value read from the input (`ctx.input.meta.x = 1`)
  trips no trap on `ctx.input` itself, so it is carried from the dump instead:
  an object-valued entry key whose dumped value no longer matches the entry
  snapshot was written through. Primitives need no such leg — a primitive
  cannot be mutated in place.
- when the recorder cannot speak — an older runner, a read that failed, a body
  that replaced `ctx.input` with a non-object — the write-back falls back to
  the full assign it did before. Narrowing on a key set that is not trustworthy
  would silently drop a write the body really made. An empty key set is a
  different answer from an absent one and does narrow.

Hook bodies only; the action path has no input write-back to inform.
