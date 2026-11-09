---
'@objectstack/service-automation': patch
---

fix(service-automation): the boot log's flow name collision line says no flow is armed when the engine refuses the name

Clause-②: no — log text only; what the engine arms, refuses or runs does not change.
Metadata-protocol: none

When a second package ships a flow of the same name, the engine's package-scoped resolver refuses the bare name for a caller with no package, and `registerFlow` arms neither flow, naming both packages (ADR-0150 D3). The boot pull's collision warning still read "arming package 'FIRST' by package id", "arming package 'FIRST' because a managed package's flow is sealed" or "arming the declared override …", depending on which other definitions sat beside the two packages, and its log meta named an armed contender.

The warning now asks the same resolver the engine asks. When it refuses the name, every such line reads "arming neither: the engine refuses this bare name for a caller with no package (ADR-0150 D3), so no definition dispatches; the 'failed to register flow' warning for 'NAME' names every holder. Rename one of them." ("arming none of them" for three or more definitions), and its meta carries `refused: true` and the contenders instead of `armed`/`shadowed`.

A name the resolver serves keeps its line byte for byte, and so does every line when no resolver is attached. `resolveFlowPrecedence` takes the reader as an optional fifth argument (`FlowNameRefusalReader`, exported as a type); the automation plugin passes it.
