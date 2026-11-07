---
'@objectstack/cli': patch
'@objectstack/spec': patch
---

fix(cli): `os validate --target` no longer refuses the engine's `parallel` and `try_catch` containers

Clause-②: yes (widening)
Metadata-protocol: none

A restriction profile's `allowedFlowNodeTypes` can only list `FlowNodeAction` ids, and the ADR-0031 containers `parallel` and `try_catch` are engine built-ins that are not among them. Under `allowCode: false`, `os validate --target` refused them as if a code plugin had registered them, and no profile could allow them. They are now structural, like `start` and `end`: always allowed, while every node inside their branches, `try` and `catch` regions is still judged. `loop` is a `FlowNodeAction` id and is still judged by the list.

The `allowedFlowNodeTypes` docblock on `RestrictionProfileSchema` now states the reader rules: `start` / `end` and the two containers are always allowed, a `script` node is also subject to `allowCode`, and a node type outside the vocabulary is governed by `allowCode`. The `allowCode` docblock states which keys a reader takes as code, including `devPlugins`, which `os build` still writes into the artifact. No schema shape or value set changes.
