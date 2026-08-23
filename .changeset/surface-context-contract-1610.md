---
'@objectstack/spec': minor
---

`ToolExecutionContext.surfaceContext` (cloud#1610): an optional, advisory description of what the user is currently discussing — Studio pillar, the selected artifact WITH its type discriminator (page/object/dashboard/report), an optional finer selection, and the canvas mode. Strictly additive beside `currentObjectName`/`currentViewName`; consumers must treat every field as optional and never use it for access decisions.
