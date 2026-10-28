---
'@object-ui/i18n': patch
---

feat(i18n): five Studio pillars, the data source pages and the field types move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Fourth slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). The keys under `engine.studio.access.*`, `engine.studio.if.*`, `engine.studio.data.*`, `engine.studio.auto.*` and `engine.studio.settings.*`, the data source pages' `engine.datasource.*`, `engine.externalDatasource.*` and `engine.datasourcePreview.*`, and the field types' `engine.fieldType.*`, `engine.fieldTypeDesc.*` and `engine.fieldCategory.*` (549 keys in both `en` and `zh`) now live in `@object-ui/i18n/namespaces/studio` instead of `@object-ui/app-shell`'s private table, text unchanged. Studio reads the same strings; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, as with the earlier slices. No export changes.
