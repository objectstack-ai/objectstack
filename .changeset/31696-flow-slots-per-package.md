---
'@objectstack/service-automation': patch
'@objectstack/metadata-protocol': patch
---

feat(automation): the engine holds, arms and runs flows by `(package, name)`, so two packages' same-named flows are both armed, each in its own slot (ADR-0150 D4, part of #31696)

Narrowing: no
Clause-②: yes (widening)
Metadata-protocol: none

Before, when two packages shipped a flow of the same name, the boot pull armed neither and logged a collision. Now each package's flow is armed in its own slot. While one package holds a name, its slot is filed under the bare name, so every key, log line and answer stays as it was. While two packages hold it, each slot is filed under `PACKAGE/NAME`.

- A bare name with two holders is refused with `RESOURCE_CONFLICT`, naming both. This covers `execute`, `getFlow`, `toggleFlow`, `unregisterFlow`, the version history and the rollback. The engine never picks one. The new slot doors (`executeSlot`, `getFlowSlot`, `getFlowSlots`, `flowSlotKey`, `toggleFlowSlot`, `withdrawFlowSlot`) serve each holder.
- A `subflow` or `map` node resolves a shared name from the package of the flow that names it.
- A stored suspended run (`sys_automation_run.flow_package`) and a stored flow credential (`flow_package`) now name their package, so they resume and resolve on their own package's flow.
- A disable row that names no package stays bound to the package that held the name alone, even after a second package arrives. An environment-authored body or row over a name two packages hold overlays neither, and logs one warning.
- Until the trigger change lands, a slot whose name another package holds is not armed on its trigger. One warning is logged per slot.

`@objectstack/metadata-protocol` fix: a package's declared `.custom` override of its own flow is now honored whichever same-named shipper registered first. Before, it was judged against the first shipper only.

New exports: `qualifiedFlowKey` and the `FlowSlot` type.
