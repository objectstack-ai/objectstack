---
'@objectstack/service-automation': patch
---

feat: a `connector_action` names its connector from the calling flow's package (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

A flow's `connectorConfig.connectorId` is now resolved through `resolvePackageScopedName` from `@objectstack/objectql`, as the package that ships the flow: its own declared connector instance, else the one holder in its declared dependency closure, else a refusal naming every candidate. An environment-authored flow names it with no package, as before.

Who is affected: a packaged flow whose `connector_action` names a declared connector instance its package can't reach: one held only by a package outside its declared dependencies, one only the environment authored (ADR-0150 D3 (a)), or one two packages in its closure both declare. That node was dispatched to whatever instance the engine held under the name; it is now refused, and the error names every candidate. Declare the dependency, or ship the instance in the flow's own package. First-party count: 0. Every first-party packaged flow names its own package's instance or a connector a plugin registers in code, which is no registry item and dispatches as before.

Corrected beside it: which package a flow run names its references from. It is the package only while that package's OWN body is armed under the flow's name (`AutomationEngine.armedFlowPackage`; the engine records where each armed body came from at every `registerFlow`). An environment override of a packaged flow, whether a package-less stored row or the shipping package's declared `.custom` override, names its `connector_action` connector and its `subflow`/`map` flow with no package, as ADR-0150 D3 says an overlay's references do. Before this, E1's subflow reader read the package that ships the flow name, so an override's subflow name resolved from that package; it now resolves as it did on main before E1. That is a loosening back to the earlier answer, not a new narrowing.
