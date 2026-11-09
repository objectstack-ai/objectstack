---
'@objectstack/service-automation': patch
---

fix(service-automation): the boot log's flow name collision line says neither flow is armed when two packages hold the name

Clause-②: no — log text only; what the engine arms, refuses or runs does not change.
Metadata-protocol: none

When two packages ship a flow of the same name, the engine refuses the name at registration, naming both packages, and arms neither flow (ADR-0150 D3). The boot pull's collision warning still read "arming package 'FIRST' by package id, and shadowing 1 other definition(s). Only the armed definition dispatches." It now reads "arming neither: 2 packages hold the name, and the engine refuses a bare name more than one package holds instead of picking one (ADR-0150 D3). Neither definition dispatches; the 'failed to register flow' warning for 'NAME' names every holder. Rename one of them."

Every other collision line keeps its wording byte for byte: a package beside a stored row, the declared override beside a stored row, and stored rows of a name no package ships.
