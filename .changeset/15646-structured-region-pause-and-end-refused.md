---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — an ADR-0031 structured region body (`loop.config.body`, a `parallel` branch, `try_catch`'s `try` / `catch`) now refuses two node populations at parse: a node whose TYPE can durably pause, and an `end` node (#15646, absorbing #18112).

`Clause-②: yes (narrowing)` — the flow accept set shrinks. Both refusals are the authoring-time enforcement of a limit the engine already holds at run time and #3267 ruled 禁: **a region body runs synchronously inside the enclosing run, so it can neither park that run nor terminate it.**

```
✗ nodes.1.config.body.nodes.0.type: A `map` node may not sit inside a structured region —
  `loop 'sweep' body → try_catch 'guard' try` is a region body and the `map` node `per_item`
  is inside it. A region body runs synchronously and cannot durably pause …
```

**What is refused**

- **A pause-capable node** — `screen`, `wait`, `subflow`, `map`, `approval`, `approval_revise`, the six built-in types whose shipped executor declares `supportsPause: true`, published as `FLOW_PAUSE_CAPABLE_NODE_TYPES`.
- **An `end` node**, whatever its `outcome`. An `end` in a region was a no-op, and a refusing one was converted into a region error at the boundary; neither is what the author wrote.

**Why it was silent, measured.** The engine converts a suspension raised inside a region into an error — but the executor has already written its progress state into the ENCLOSING scope by then. Contain that error in a `try_catch` and the residue is read back as progress by the next entry to the same node. On a real `AutomationEngine`, `loop { try_catch { map(pausing child) } }` over 3 iterations × 2 items: not one item's subflow completed, only two of three iterations reached the catch, and iteration 3 read `started === collection.length`, ran nothing, and returned `success` with `summary.failed = 0`. A sweep that reports green having processed nothing is the worst available failure, and it is reachable only because the shape can be declared at all.

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `loop { body: [ …, end ] }` | `loop { body: [ … ] } → end` — give the region a normal exit and put the terminator, with its `outcome` / `message`, on the top-level graph |
| `loop { body: [ try_catch { try: [ map ] } ] }` | a top-level `map` — its per-item subflow already iterates, so the enclosing `loop` is usually redundant, and the `try_catch` that existed only to contain the region's refusal goes with it |
| `parallel { branches: [ [ approval ] , … ] }` | put the `approval` on the top-level graph and fan out around it, or split the branch's pausing half into a `subflow` the top-level graph calls |

The one-line fix is always the same: **move the node onto the top-level graph and route the region's exit to it.** ⛔ Not mechanically convertible — hoisting a node out of a region is a graph rewrite (new edges, a changed exit, sometimes a deleted container) and which shape the author meant is an intent no artifact records, so this ships as an ADR-0087 D3 structured TODO rather than a D2 conversion.

<!-- adr-0087: registered structured-region-body-pause-and-end-refused -->

**⚠️ Wider than the runs that actually broke, deliberately.** The rule judges the node TYPE. A `map` or `subflow` pauses exactly when the child flow it names pauses, so a region-nested `map` over a synchronous child ran green before and is refused now. That shape's legality lived in a DIFFERENT metadata record and could be revoked by editing that record — "legal until somebody adds a `wait` to the child flow" is not a contract an author can rely on, and a parse of one flow cannot answer it.

**⚠️ Two boundaries this refusal does not reach, stated rather than discovered.** A pausing node type contributed by a **plugin** is not refused: ADR-0018 left the node-type namespace open and a parse has no registry. A region nested past **`MAX_REGION_DEPTH` (32)** is not judged: the parse walk stops there, and unlike a duplicate node id there is no second spec refusal behind it. For both, the engine's run-time refusal is the only one — unchanged by this change, and not fixed by it.

⛔ `packages/services` is untouched. The engine's run-time refusal stays exactly as it was; this moves the refusal to where the author is standing, it does not replace it.
