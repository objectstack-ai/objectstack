---
'@objectstack/rest': patch
---

`GET /api/v1/meta/view/<object>`, the by-name read of a `defineView` container, answers `200` on an artifact boot, and translates the views inside the container on every boot

Clause-②: no

The registry files a `defineView({ object, list, listViews, … })` container under the object it binds, and serves it on the by-name read of that key. The read handed the container to the translator for one view, which reads the view's own `name`.

- **Artifact boot** (`os build`, then `os serve` of the artifact): a compiled container carries no `name`, so the read answered `500 INTERNAL_ERROR` and the log read `Cannot read properties of undefined (reading 'startsWith')`. It now answers `200`.
- **Config boot** (`os serve objectstack.config.ts`): its registrar stamps `name: <object>` onto the container, so the read answered `200`. But it served a `label` equal to the object name, which no author wrote, and it left every view inside the container in the authored language. That label is no longer served.
- **What is translated now, on both boots.** Each view inside the container (`list`, `form`, each `listViews` and `formViews` entry) carries the same `label`, `description` and bulk-action copy as the by-name read of the view it expands to (`<object>.<key>`). That copy is keyed by the same `objects.<object>._views.<key>` entry and judged against the same packaged base, so an organization's explicit override still beats the catalog. The container's own `label` and `description` are read from `objects.<object>._views.<object>`, and are left unchanged when the catalog has no entry there.
- **What stays the same.** The by-name reads of the expanded views and the `GET /api/v1/meta/view` list are unchanged. The list still never includes a container.
- **Packaging.** `@objectstack/rest` now lists `@objectstack/metadata` under `dependencies` (it was a dev dependency). The read imports `deriveViewContainerObject` from `@objectstack/metadata/view-container`, the registry's own derivation of the object a container binds.
