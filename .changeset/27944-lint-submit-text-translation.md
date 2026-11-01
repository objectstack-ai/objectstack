---
'@objectstack/lint': patch
---

`validateTranslationReferences` judges an action translation's new `submitText` key (`@objectstack/spec`'s param dialog submit label). Under an action that declares no `params`, at `objects.OBJECT._actions.ACTION.submitText` or `globalActions.ACTION.submitText`, it reports `translation-target-unknown` at `error`: such an action opens no param dialog, so nothing reads the label. Under an action that declares `params` the key is accepted.

Clause-②: no
Metadata-protocol: none
