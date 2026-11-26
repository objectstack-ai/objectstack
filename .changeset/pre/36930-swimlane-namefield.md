---
'@object-ui/plugin-kanban': patch
---

fix(plugin-kanban): a reference swimlane heading names its record through the target object's declared `nameField`

Clause-②: no
Metadata-protocol: none

A board whose swimlanes group by a lookup now titles each swimlane the way a column lane over the same reference is titled: the field's `displayField`, then the referenced object's `nameField` (ADR-0079), then the shared title ladder. Before, the swimlane skipped the referenced object's `nameField`, so one record could be named differently in a swimlane heading and in a column heading. `ObjectKanban` reads the referenced object once per board; no exported type changes.
