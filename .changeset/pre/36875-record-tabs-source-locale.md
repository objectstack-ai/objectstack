---
'@object-ui/app-shell': patch
---

fix(app-shell): the record-tabs rename in the design mode decides "source language" from the served `sourceLocale`, not the default locale

Clause-②: no
Metadata-protocol: none

「Configure tabs」 lets a tab be renamed only in the app's source language, where the name written is the source label. It used to decide that by comparing the reader's language with the deployment's default locale. It now reads the source language `GET /i18n/locales` serves (`sourceLocale`, the default locale where none is served), the same reading the app menu's rename takes. On a deployment whose default locale differs from its source language, a reader in the default locale no longer writes a tab name as the source label, and a reader in the source language can rename again.
