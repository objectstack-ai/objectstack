---
'@objectstack/lint': patch
---

`validateTranslationReferences` judges an action translation's new `cancelText` key (`@objectstack/spec`'s dismiss label of an action's confirm and param dialogs). Under an action that declares neither `confirmText` nor `params`, at `objects.OBJECT._actions.ACTION.cancelText` or `globalActions.ACTION.cancelText`, it reports `translation-target-unknown` at `error`: such an action opens no dialog, so nothing reads the label. Under an action that declares either the key is accepted.

Clause-②: no
Metadata-protocol: none
