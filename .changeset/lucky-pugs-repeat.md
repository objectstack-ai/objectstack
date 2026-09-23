---
'@objectstack/platform-objects': patch
---

Translate the report and dataset form panel leaves that shipped their English source in every locale

Four metadata-form keys — `report.fields.dataset`, `report.fields.values`, `report.fields.rows` and `dataset.fields.measures` — carried labels byte-identical to their `en` source in `zh-CN`, `ja-JP` and `es-ES`, so an author working in a translated locale read English on those two panels while everything around them was translated. Twelve label leaves and nine `helpText` leaves at the same four keys are now translated; each was judged individually, and the verdicts with their reasons are pinned in `report-dataset-panel-echo-decisions.test.ts`. No key was added, removed or renamed — the bundles' shape is unchanged.
