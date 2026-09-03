---
"@objectstack/service-automation": patch
---

fix(automation): the healthy subflow up-bubble no longer logs the degraded "child run is gone" warning

Every successful subflow completion logged, at `warn`:

```
[automation] run 'R' is paused at subflow node 'N' but child run 'C' is gone — continuing without child output
```

Both halves of that sentence were false on this path. The child had not gone
anywhere — it had *completed*, which is the normal outcome — and the parent was
continuing **with** the child's output, not without it: the very signal the
engine was holding when it wrote the line already carried it.

The cause is that the branch keyed off a suspension lookup. A parent parked at a
`subflow` node correlates to its child as `subflow:CHILDID`, and on resume the
engine calls `loadSuspendedRun(CHILDID)`. That finds only **SUSPENDED** runs, so
a child that finished has no suspension to find, and the miss fell through to an
`else` written for the genuinely degraded case. The lookup answers "is the child
still parked", which on the up-bubble is a question about nothing: the child is
supposed to be finished there.

The branch now asks the fact the message is actually about — whether the incoming
resume signal already carries the child's output, which is what the engine's own
`buildSubflowResumeSignal` mints when a completed child bubbles into its parent.
When it does, the run continues from the subflow node with a `debug` line naming
the carried output. When there is no child run **and** no carried output, the
degraded case is real and keeps its existing sentence at its existing level.

The engine-built marker is part of the test, not decoration: `output` is a
caller-writable field and on this node a caller's signal is delegated down to the
child, so matching on shape alone would let a caller's own bag silence a genuine
degraded warning. Only the engine can mint that marker.

No behaviour changes: both branches continue the parent exactly as before, no log
call site changes level, and the degraded sentence is untouched. This is a
logging correctness fix — an ordinary outcome had been reported as a fault on
every healthy subflow completion, which is the cry-wolf shape that trains an
operator to skip the line on the one occasion it means what it says.
