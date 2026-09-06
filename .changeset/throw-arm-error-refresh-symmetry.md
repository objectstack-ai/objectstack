---
"@objectstack/service-automation": patch
---

`$error` now names the most recent failure in a flow run, whichever way that failure arrived.

The automation engine has two failure arms. When a node FAILS BY RETURNING `{ success: false }`, the engine rewrote the run-wide `$error` (and `<nodeId>.error`) and then decided whether a `fault` edge could route it. When a node FAILED BY THROWING — a `timeoutMs` firing, a dying nested container, a thrown guard — it did both **inside** the `fault`-edge branch, so a thrown failure with no `fault` edge of its own left `$error` holding an earlier, unrelated failure's value.

A node inside a structured region never has a `fault` edge of its own: the region's synthetic sub-flow carries only the region's own edges. So every thrown failure inside a `try_catch`, `loop` body or other region hit this. The result was not a crash but a plausible-looking wrong value: **the message and the code came from two different failures** — `{ code: 'DUPLICATE_RECORD', message: "Node 'mk' timed out after 20ms" }` — and a catch region branching on `{$error.code}` swallowed a store failure as "the row is already there" while the run reported success.

The throw arm now publishes `$error` and `<nodeId>.error` before deciding whether the failure routes, exactly as the returned-failure arm does. What a thrown failure publishes is `{ nodeId, message }`: there is no node result on that path, so no `output` and no classified `code` exist to carry — and that absence is the right answer for a throw rather than a reason to leave a stale `code` standing.

Routing is unchanged. A guard refusal that throws (ADR-0049's unscoped-run refusal, for one) is still un-routable, still fatal, and still reports its own message; the thrown value itself is rethrown exactly as caught.
