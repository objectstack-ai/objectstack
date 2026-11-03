---
'@objectstack/lint': patch
---

fix(lint): `flow-region-shape-invalid` points at the region container at fault, not only the flow

Clause-②: no
Metadata-protocol: none

A flow the automation engine refuses for its region shape used to be reported on the whole flow (`flows[1]`, `flow 'lead_time'`). The finding now names the container the engine's refusal names: its `path` runs to that node inside the flow (`flows[1].nodes[1].config.try.nodes[0]`) and its `where` reads `flow 'lead_time' › node 'fan'`. The location is read off the `FlowRegionShapeError` that `validateControlFlow` throws, never parsed from the sentence; the message is unchanged, still the engine's refusal behind the flow's name. The engine stops at a flow's first malformed region, so there is still one finding per flow. Any other error keeps the flow as the anchor, as before.

On the server, the save and publish verdict of an active flow and a draft's diagnostics carry the same move in item-relative spelling: the path was the item root and is now the container, for example `nodes.1`.
