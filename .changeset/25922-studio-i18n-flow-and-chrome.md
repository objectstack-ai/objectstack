---
'@object-ui/i18n': patch
---

feat(i18n): the flow designer and the rest of the Studio chrome move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Sixth slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). Every row still left in `@object-ui/app-shell`'s private designer table, except `engine.translationPreview.*`, now lives in `@object-ui/i18n/namespaces/studio`, text unchanged: the flow designer (`engine.flowSim.*`, `engine.flowCanvas.*`, `engine.flowRuns.*` and the other `engine.flow*` families), the page-block canvas, the doc and book previews, `engine.studio.inspector.*` and the remaining Studio chrome (538 keys in `en`, 583 in `zh`). The `engine.flowNode.*` and `engine.enum.*` rows stay zh-only, as before: their English is the flow node descriptor or the enum value itself. Studio reads the same strings; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, as with the earlier slices. No export changes.
