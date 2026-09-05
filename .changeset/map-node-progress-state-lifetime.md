---
"@objectstack/service-automation": patch
---

A `map` node inside a `loop` body now runs its collection on every iteration, not just the first.

`map` tracks its progress through the collection in the flow variable `<nodeId>.$mapState`, and wrote it into the flow's **shared** variable scope without ever removing it. A `loop` body region runs in that same scope by construction — that is what makes the iterator variable and the body's mutations visible to the rest of the flow — so the state written by iteration 1 was still there when iteration 2 entered the map. It read back `started === collection.length`, correctly concluded there was nothing left to start, and returned.

The result was silent partial work reported as success: measured on the engine, **5 iterations x 2 items produced 2 child runs instead of 10**, the map step reported `success` on all five iterations, and the run finished `completed`. Nothing threw and nothing was caught, so `FlowRunSummary.failed` — the run-level counter that exists to expose contained failures — reported `failed = 0` over it. An operator reading that counter was told the run was clean while it had done a fifth of its work.

The fix is a lifetime correction, not a new key: `$mapState` is now removed once the collection is exhausted, so its lifetime is one execution of the collection rather than the enclosing scope's.

**The durable-pause path is deliberately unchanged.** A `map` whose per-item subflow pauses still writes its progress before suspending, and still reads it back when the engine re-enters the node — that write is the mechanism resume depends on, because a resume rebuilds the variable scope from the snapshot taken at the suspend and so can never see any later write. Only the node's terminal path clears the key. A `map` resumed mid-collection continues where it left off, exactly as before, and no item is re-run.
