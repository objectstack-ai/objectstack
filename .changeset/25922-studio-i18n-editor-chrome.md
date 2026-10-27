---
'@object-ui/i18n': patch
---

feat(i18n): the rest of the Studio inspectors and the package, form and editor strings move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Third slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). The remaining `engine.inspector.*` keys and every `engine.packages.*`, `engine.form.*` and `engine.edit.*` key (551 in `en`, 560 in `zh`) now live in `@object-ui/i18n/namespaces/studio` instead of `@object-ui/app-shell`'s private table, text unchanged. The nine `engine.packages.form.help.*` rows stay `zh`-only: their English is the producer's own help text, read through `tOptional`. Studio reads the same strings; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, as with the earlier slices. No export changes.
