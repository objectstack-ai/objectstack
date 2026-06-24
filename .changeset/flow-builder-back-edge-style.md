---
'@objectstack/spec': patch
---

feat(spec): add the `back` edge style to the flow-builder canvas protocol

`FlowCanvasEdgeStyleSchema` gains a `back` value alongside `solid`/`dashed`/`dotted`/`bold`, marking an ADR-0044 declared back-edge (a `revise` loop's resubmit edge). Flow-builder-protocol consumers can now render it as a distinct curved/dashed return arc, set apart from forward flow — matching the objectui designer's hand-rolled canvas (objectstack-ai/objectui#1954). Part of #2274.
