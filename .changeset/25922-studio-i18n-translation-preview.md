---
'@object-ui/i18n': patch
---

feat(i18n): the translation preview's strings move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Last rows of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). The 23 `engine.translationPreview.*` rows in each language, the last family left in `@object-ui/app-shell`'s private designer table, now live in `@object-ui/i18n/namespaces/studio`, text unchanged. The table is now empty; deleting it is a later slice. Studio reads the same strings; a Chinese viewer sees the translation preview's labels in English for the moment the `zh` catalogue takes to load, as with the earlier slices. No export changes.
