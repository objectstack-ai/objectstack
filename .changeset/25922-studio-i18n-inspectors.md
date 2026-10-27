---
'@object-ui/i18n': patch
---

feat(i18n): the Studio inspectors' page block, action, dataset, flow node, app navigation and dashboard widget strings move into the `studio` namespace

Clause-②: no
Metadata-protocol: none

- **Second slice of the move ruled on objectstack#25922** (6431032267, Q2 = A; kept by 6431234244). The 520 keys under `engine.inspector.pageBlock.*`, `engine.inspector.action.*`, `engine.inspector.dataset.*`, `engine.inspector.flowNode.*`, `engine.inspector.appNav.*` and `engine.inspector.widget.*` now live in `@object-ui/i18n/namespaces/studio` instead of `@object-ui/app-shell`'s private table, text unchanged in both `en` and `zh`. Studio reads the same strings; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, as with the first slice. No export changes.
