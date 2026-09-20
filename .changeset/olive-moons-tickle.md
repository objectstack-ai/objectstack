---
'@objectstack/platform-objects': patch
---

Translate the object field-editor panel leaves that shipped their English source in every locale

Fourteen metadata-form keys under `object.fields['fields.*']` — the field editor on the object form (`placeholder`, `valueDomain`, `rows`, `lookupFilters`, `deleteBehavior`, `expression`, the four `summaryOperations` entries, `autonumberFormat`, `visibleWhen`, `readonlyWhen`, `requiredWhen`) — carried both their `label` and their `helpText` byte-identical to the `en` source in `zh-CN`, `ja-JP` and `es-ES`, so an author working in a translated locale read English on the most trafficked authoring panel in Studio while everything around them was translated. All 28 leaves are now translated in each locale; each was judged individually, and the 84 verdicts with their reasons are pinned in `object-field-editor-panel-echo-decisions.test.ts`, which also derives the panel's population so a re-fill or a newly added field is red on the day it lands. No key was added, removed or renamed — the bundles' shape is unchanged.
