---
'@objectstack/spec': patch
---

Document the retry/durable-pause boundary on a flow's `errorHandling` block: a durable
pause (`approval`, `screen`, `wait` — ADR-0019) **ends the retry-governed segment**.
`errorHandling.strategy: 'retry'` describes one synchronous dispatch, so a run that pauses
and later resumes gets exactly one attempt for anything that fails after the pause.

Prose only — no validation change. The accepted flow set is unchanged and every flow that
parsed before parses identically; what changes is that the boundary is now stated where an
author meets it (the `errorHandling` and `strategy` `describe()` text, which is what the
generated reference tables render) instead of having to be inferred from engine behaviour.

The boundary is deliberate rather than a gap: the retry knobs (`backoffMs`,
`backoffMultiplier`, `jitter`) model an in-process loop, which a pause of arbitrary
duration is not, and the durable continuation carries no attempt counter. To protect the
half of a flow that runs after a pause, give that half its own failure handling in the
flow — a `try_catch` node with its own `retry` around the post-resume work, or a `fault`
edge to a handler node. `content/docs/automation/flows.mdx` carries the recipe.
