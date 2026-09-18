---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — an ADR-0031 structured region body (`loop.config.body`, a `parallel` branch, `try_catch`'s `try` / `catch`) now refuses two node populations at parse: a node whose TYPE parks the run on every execution, and an `end` node (#15646, absorbing #18112).

Clause-②: yes

The flow accept set shrinks for five node types inside region bodies — shapes the runtime never honoured. Both refusals are the authoring-time enforcement of a limit the engine already holds at run time and #3267 ruled 禁: **a region body runs synchronously inside the enclosing run, so it can neither park that run nor terminate it.**

```
✗ nodes.1.config.body.nodes.0.type: A `approval` node may not sit inside a structured region —
  `loop 'sweep' body → try_catch 'guard' try` is a region body and the `approval` node `sign_off`
  is inside it. A region body runs synchronously and cannot durably pause …
```

**What is refused**

- **A node that pauses on EVERY execution** — `screen`, `wait`, `approval`, `approval_revise`.
- **An `end` node**, whatever its `outcome`. An `end` in a region was a no-op, and a refusing one was converted into a region error at the boundary; neither is what the author wrote.

**⛔ What is deliberately NOT refused: `subflow` and `map`.** Their shipped executors also declare `supportsPause: true`, but they pause exactly when the child flow their `config.flowName` names pauses — a **different metadata record**, not in hand while this flow is parsed. Refusing them by type would also refuse `loop { map(synchronous child) }`, a shape that runs correctly today and is covered by an existing regression suite. A parse-time rule refuses what is statically wrong; a region-contained node that actually suspends is a fact only the run holds. **Nothing an author wrote with a region-nested `map` or `subflow` needs editing for this release.**

**Why it was silent, measured.** The engine converts a suspension raised inside a region into an error — but the executor has already written its progress state into the ENCLOSING scope by then. Contain that error in a `try_catch` and the residue is read back as progress by the next entry to the same node. On a real `AutomationEngine`, `loop { try_catch { map(pausing child) } }` over 3 iterations × 2 items: not one item's subflow completed, only two of three iterations reached the catch, and iteration 3 read `started === collection.length`, ran nothing, and returned `success` with `summary.failed = 0`. ⚠️ Read that for the MECHANISM, not for this change's reach — the shape it was measured on is a `map`, and making that run's refusal loud is a separate change to the automation engine, not this one.

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `loop { body: [ …, end ] }` | `loop { body: [ … ] } → end` — give the region a normal exit and put the terminator, with its `outcome` / `message`, on the top-level graph |
| `loop { body: [ wait ] }` | a top-level `wait`, with the top-level graph as the repeating construct — a region body cannot park the run, so the nested form never waited |
| `parallel { branches: [ [ approval ] , … ] }` | put the `approval` on the top-level graph and fan out around it, or split the branch's pausing half into a `subflow` the top-level graph calls |

The one-line fix is always the same: **move the node onto the top-level graph and route the region's exit to it.** ⛔ Not mechanically convertible — hoisting a node out of a region is a graph rewrite (new edges, a changed exit, sometimes a deleted container) and which shape the author meant is an intent no artifact records, so this ships as an ADR-0087 D3 structured TODO rather than a D2 conversion.

<!-- adr-0087: registered structured-region-body-pause-and-end-refused -->

**⚠️ Two boundaries this refusal does not reach, stated rather than discovered.** A pausing node type contributed by a **plugin** is not refused: ADR-0018 left the node-type namespace open and a parse has no registry. A region nested past **`MAX_REGION_DEPTH` (32)** is not judged: the parse walk stops there, and unlike a duplicate node id there is no second spec refusal behind it. For both, the engine's run-time refusal is the only one — unchanged by this change, and not fixed by it.

⛔ No engine source is edited. What the refusal does to the run time is stated rather than left to be discovered: `AutomationEngine.registerFlow` and the ADR-0087 stored-row rehydration seam both go through `FlowSchema.parse` (`canonicalizeStoredFlow`), so a flow carrying a refused shape no longer registers or rehydrates — it is met at LOAD, not at the region boundary, and a stored row that carries one stops loading until it is rewritten. The engine's own run-time refusals for these shapes stay in place but are reachable only through the two boundaries above; for the `end` arm those are the only remaining path, because the refusal signal it answers is raised at exactly one site — an `end` node whose `outcome` is `refused`.

**Published surface.** `FLOW_PAUSE_CAPABLE_NODE_TYPES` was never released; this change publishes `FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES` instead — the four types above — so the exported name states the population the rule actually keys on rather than a capability list two of whose members it does not judge.
