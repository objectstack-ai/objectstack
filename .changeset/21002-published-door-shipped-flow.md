---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest,runtime): the published-snapshot read of a flow name a managed package ships answers the package's flow, as the layered read does (#21002)

Clause-②: yes (widening)

`flow` is in ADR-0126's Regime C: a managed package's flow is sealed, and there is no overlay read path for it. Since the previous half of #21002, the layered read, `GET /api/v1/meta/flow/:name/layers`, reports the package's flow as the effective layer for a name a managed package ships, and a stored flow of that name as a separate layer that does not take effect. The published-snapshot read, `GET /api/v1/meta/:type/:name/published`, and its runtime-dispatcher twin read that same layered answer, but served its stored layer whenever one was present. So for such a name they still answered `200` with the stored flow, not the package's.

Both published-snapshot doors now serve the layered read's effective layer when that read put the package's flow over a stored flow, which is the package's flow. They ask the metadata protocol's own check for that decision rather than repeating it. In every other case they answer exactly as before: a flow name no managed package ships, and every other metadata type, `object` included, still answer the stored layer when one is present, and an item with no stored layer still falls through to the code/package snapshot. The stored flow is not deleted, rewritten or refused.

**The widening.** `@objectstack/metadata-protocol` makes one existing method public: `ObjectStackProtocolImplementation.isShippedFlowName(type, name)`. It answers whether `name` is a flow name a managed package ships. It was private to the class, so a door in another package could not ask it any other way. Its answer is unchanged, and the layered read, the by-name read and the flow list keep calling it.
