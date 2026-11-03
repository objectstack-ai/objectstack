---
'@objectstack/spec': patch
---

feat(spec): `validateControlFlow` throws `FlowRegionShapeError`, carrying the faulty container's path and node id

Clause-②: yes (widening)
Metadata-protocol: none

`validateControlFlow` (`@objectstack/spec/automation`) now throws an exported `FlowRegionShapeError` at each of its three refusals: a region its schema refuses, a region that is not single-entry, single-exit and acyclic, and a `parallel` block with fewer than two branches. The error carries `path`, the key path from the flow root to the container node that owns the fault (the spelling of `collectFlowGraphs`' `FlowGraph.path` plus `['nodes', i]`, for example `['nodes', 1, 'config', 'try', 'nodes', 0]`), and `nodeId`, that container's id. A reader can now locate the fault without parsing the sentence, including a `parallel` block nested inside another container, whose sentence names no enclosing scope.

The message is unchanged byte for byte, and the class extends `Error`, so a caller that reads `err.message` or tests `instanceof Error` sees no difference. Nothing a flow author writes is accepted or refused differently.
