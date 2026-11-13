---
'@object-ui/data-objectstack': minor
'@object-ui/app-shell': patch
---

fix(app-shell): a flow started from a record action, or resumed from its screen, warns the person who clicked when a write step dropped a read-only field, naming the field by its label

Clause-②: yes (widening) — `@object-ui/data-objectstack` exports its existing `droppedFields` wire gate and parser (`isWireDroppedFieldsEntry`, `asDroppedFieldsNotice`, and the `WireDroppedFieldsEntry` type they share); no i18n key is added
Metadata-protocol: none

A flow whose `update_record` step wrote a `readonly` field (「提交审批」 writing `status`) lost the value in silence: the step succeeded, the run answered success and the record stayed where it was. Since objectstack#32861 the run's answer names those fields (`droppedFields`). The console now reads that member on both launch hosts (the list and page action runtime, the record page) and on the screen-flow runner's resume, and shows the same warning a record save shows for the same strip: "Saved — but some fields did not take effect", one line per reason, fields named by their labels from the object's schema. A run that drops nothing, or an answer from a server that predates the member, shows exactly what it showed before.
