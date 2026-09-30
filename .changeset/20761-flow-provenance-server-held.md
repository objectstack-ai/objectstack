---
'@objectstack/metadata-protocol': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': patch
---

fix(automation): which flows are packaged is the package loader's fact, never the flow definition's own, and every flow written through an authoring door is authored in the deployment (#20761)

Clause-②: yes (widening)

A flow counts as packaged only when a managed package's loader registered it (ADR-0126 §2, ADR-0131 D6). Before this change, a flow definition written through an authoring door could carry a code package's provenance, and the automation engine then treated that flow as the package's.

- **The automation engine reads the loader's set.** The ADR-0126 §7.3 subflow guards, the arming gate, the activation switch and the package an activation row names now come from the packages the loader registered. The provenance a flow definition carries is kept for display only. `AutomationEngine` gains `setPackagedFlowSource(reader)` and `packagedFlowOwner(name)`, and the package exports the `PackagedFlowSource` type. `AutomationServicePlugin` attaches the reader for you: it asks the metadata protocol when the engine needs the answer. An engine with no reader attached treats no flow as packaged.
- **One authoring rule for flows.** `ObjectStackProtocolImplementation` gains two methods. `packagedArtifactOwner({ type, name })` names the package whose loader registered an item. `tenantAuthoredWriteRefusal({ type, name, item, packageId? })` is the rule every flow write door asks: the automation create, update and clone doors, and the metadata door's flow write.
  - A write to a name a package ships is refused as a locked base. The answer is `packagedBaseRefusal`'s own (`403 NOT_OVERRIDABLE`), so sending a shipped flow's definition back is refused.
  - A definition that claims a code package's provenance for a name no package ships is refused with `422 INVALID_METADATA`, and nothing is written. Before, the automation doors kept the claim and the metadata door removed it without saying so.
  - A customer flow's definition sent back as it was read is accepted as before. That includes a stored flow bound to one of your own packages, whose read carries that binding.
  - `packagedBaseRefusal` also takes an optional `packageId`, the base a save names.
- **The metadata door's other types are unchanged.** Only flows are judged by this rule. Migrating stored rows and duplicating a package are not affected either.
- **A clone is saved.** `POST /automation/:name/clone` now writes its copy as a stored flow of the deployment, through the metadata protocol's save, with no package provenance. The copy reads back on the metadata door and is still there after a restart. Before, it lived only in the running engine and was gone after a restart. If the save fails, the clone is withdrawn and the failure is returned.

**If a write of yours is now refused with `422 INVALID_METADATA`:** remove the package provenance from the flow definition and send it again. To customize a packaged flow, clone it under a new name.
