---
'@object-ui/i18n': patch
---

feat(i18n): the rest of the Studio strings and the metadata preview panes move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Fifth slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). Every remaining `engine.studio.*` key except `engine.studio.inspector.*`, and the preview panes' `engine.*Preview.*` and `engine.previewShell.*` keys (the doc, book, flow, page-block and translation previews stay for a later slice), 596 keys in both `en` and `zh`, now live in `@object-ui/i18n/namespaces/studio` instead of `@object-ui/app-shell`'s private table, text unchanged. Studio reads the same strings; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, as with the earlier slices. No export changes.
