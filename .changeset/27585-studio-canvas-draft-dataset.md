---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio canvas runs a report or a dashboard widget over a draft dataset before the package publishes (#27585)

Clause-②: yes (widening)
Metadata-protocol: none

A Studio author who created a dataset and bound a report or a chart to it saw "Dataset … is not defined in this environment" on the canvas until the package published, while the dataset pickers beside it already offered the draft. The canvas's dataset query went to the published world, where a draft-only dataset does not exist.

- **`queryDataset(dataset, selection, options?)`** in `@object-ui/data-objectstack` takes an optional `{ previewDrafts?: boolean }`. `true` asks for the draft world on that one request (the server resolves draft-overlaid dataset definitions and the pending seed drafts' rows, as `?preview=draft` does), the way `listViews(objectName, { previewDrafts })` asks for draft views. When the option is absent, the page URL's `?preview=draft` decides, as before; when it is given, it wins over the URL. A caller that passes nothing sends exactly the request it sent before.
- **The Studio's report and dashboard previews** hand the runtime renderers a data source whose dataset queries carry `previewDrafts`, keyed on the signal the Studio's dataset pickers read (the dataset-authoring context). The query still names the dataset and the server resolves it; there is no second lookup. Setup's editors and every runtime page are unchanged and query the published world, or the one the page URL asks for. The server answers the draft world only to a caller who may read drafts; anyone else gets the published dataset, as if the flag were absent.
