---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(i18n): the action param dialog's preflight panel reads its row labels from the translation bundle

Clause-②: yes (widening)
Metadata-protocol: none

`useObjectLabel()` gains `actionPreflight(objectName, actionName, preflight)`, the client mirror of `actionResultDialog` for an action's declared `preflight` read. It overlays the bundle's `objects.OBJECT._actions.ACTION.preflight.fields.PATH` strings (with no key object, `globalActions.ACTION.preflight.fields.PATH`), the key `@objectstack/spec` already resolves on the REST side, onto the declared `fields` rows only, each keyed by its literal path. A bundle path that no row declares adds nothing, and a row with no bundle string keeps its authored label, an inline per-locale map included. Both console param-collection handlers (the shared action runtime and the record page's own) now pass the action's `preflight` through it before handing the block to the dialog, so a zh or ja user sees localized row labels in the preflight panel.
