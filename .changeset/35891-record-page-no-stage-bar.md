---
'@object-ui/plugin-detail': minor
'@object-ui/components': minor
'@object-ui/i18n': patch
'@objectstack/lint': minor
---

feat(plugin-detail): the default record page draws no stage bar and no key-field strip; the stage moves from the header's status tag

Clause-②: yes (widening)
Metadata-protocol: semantic

The default record page (`buildDefaultPageSchema`) no longer emits `record:highlights` or `record:path`. The stage is the status tag beside the record's name: a reader who may edit the stage field sees it with an arrow and opens a menu listing every stage in order, the current one checked; a stage the field's blocking `state_machine` cannot reach is disabled with its reason under the name. Picking a stage confirms, and a stage that makes other fields required (their `requiredWhen` holds once the record stands on it, such as a loss reason on a lost stage) asks for exactly those fields in the same dialog and writes them with the move. A refusal stays in the dialog, beside the field it names, and the stage does not move. A reader who may not edit the field, an approval lock or an open draft leaves the plain tag. A plain status field (no stage role) is read and moved the same way.

The details body now draws every field its groups hold: the highlight fields and the stage field are no longer taken out of their groups, so a record reads in the same groups and order in view and in edit (objectstack#35849). `highlightFields` itself is unchanged and still drives the hover card, a related list's default columns and the record picker; nothing is picked when an object declares none.

`buildDefaultHighlights` and both blocks are kept: an authored page, or a slotted page's `highlights` slot, still places a strip and a path where it wants them.

- `@object-ui/components`: `RecordHeaderState` gains an optional `stage` renderer (with the exported `RecordHeaderStageParts`), which the header calls with the stage tag it would draw. Without a host bar (a phone) the header now draws the stage tag in the row under the record's name, beside the state's tags; before, a phone showed no stage at all.
- `@object-ui/plugin-detail`: exports `RecordStageMenu`, the menu a host hands the header as `RecordHeaderState.stage`. Its fields-a-stage-needs dialog comes from the package-internal `useStageChange` (`record:path` keeps its plain confirmation).
- `@object-ui/plugin-detail`: `BuildPageOptions.highlightFields`, `.statusField` and `.stages` are still accepted by `buildDefaultPageSchema` and `buildDefaultTabs` but no longer do anything there, since the default page draws no strip and no stage bar; `buildDefaultHighlights` still reads them. Retiring them is objectstack#35943.
- `@object-ui/i18n`: four `detail.stageMenu*` strings in every locale.
- `@objectstack/lint`: `field-group-shadowed` no longer counts the highlight strip as hiding fields from the detail body, since the default record page leaves them in their groups; a group whose only visible member is the record title still warns.
