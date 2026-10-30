---
'@objectstack/objectql': patch
---

fix(objectql): a flow a composed stack declares only on its top level, beside package bodies that do not declare it, registers with the automation engine at boot

Clause-②: yes (widening)
Metadata-protocol: none

The engine's `manifest` service registers a multi-package stack's residual (top-level items no package body declares, ADR-0130 D4) objects and connectors under the stack's own `manifest.id`; it now registers the residual's flows the same way. The automation plugin's boot pull reads flows from the ObjectQL registry only, so a residual flow used to be listed by the metadata service and never registered with the engine: `getFlow` answered `null`, a run answered "not found", and its trigger never armed. Such a flow now registers and runs at boot. A flow a package body declares is still registered once, under that body; stacks whose top level repeats their bodies, and single-package stacks, are unchanged.
