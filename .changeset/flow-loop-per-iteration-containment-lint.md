---
"@objectstack/lint": patch
---

flows: warn on a `loop` body with a fallible node and no containment, and on a `try_catch` with no `catch` (#14394)

Two authoring-time rules in the flow anti-pattern family, both `warning`:

- **`flow-loop-body-uncontained`** — a `loop` whose `body` region runs a node
  that can end the run (a record read/write, `http`, `notify`,
  `connector_action`, `script`, `subflow`, `map`, `approval`) with no
  `try_catch` between the loop and that node. The `loop` executor iterates with
  a bare `await` and has no `try`/`catch` at all, so the first failing item ends
  the whole run: later items are never processed, and the work already done is
  not even reported. The finding names the loop, the node, and the prescribed
  spelling.
- **`flow-try-catch-without-catch`** — the near-miss, and the first target
  rather than an extra: `catch` is optional in the schema, and omitting it makes
  the container fail through, so an author who wrapped the node and stopped
  there gets **zero** containment and previously got no diagnostic either.
  Measured, the no-`catch` run and the unwrapped control produce identical
  output; a `retry` policy only delays that.

Both stay warnings under the family's severity bar: a loop deliberately allowed
to stop at the first failure, and a retry-then-fail `try_catch`, are legitimate
readings the rule cannot disprove.

`content/docs/automation/flows.mdx` documents `loop { try_catch { … } }` as the
per-iteration containment spelling, with the measured minimal handler — one bare
`assignment` node, `edges` and `errorVariable` omitted — and the three `catch`
spellings the schema refuses (`catch` omitted gives no containment; `catch: {}`
and `catch: { nodes: [] }` are rejected, the region's `nodes` being `.min(1)`).

No spec, engine or runtime change: the containment capability already exists and
was measured working (5 of 5 iterations, items 4-5 processed, run completes).
