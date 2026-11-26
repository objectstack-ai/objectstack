---
'@object-ui/components': patch
---

fix(components): `action:menu`, `action:group` and `action:icon` render no text for a label that is not a string, instead of crashing or printing `[object Object]`

Clause-②: no
Metadata-protocol: none

An action `label` is a string, localized through the translation bundle entry for the component id (`pages.PAGE.components.COMPONENT_ID.label`). A non-string label, such as an inline locale map from code-registered page metadata that never passed `validateComponentProps`, used to throw "Objects are not valid as a React child" from an `action:menu` trigger, an `action:group` member or dropdown trigger, and an `action:icon` with no icon; an `action:icon` with an icon wrote `[object Object]` into its accessible name. These three renderers now read every label, their own and each member's, through the same guard `action:button` uses, so a non-string label renders as no label: the menu trigger keeps its "More actions" name, a group dropdown shows "Actions", a menu or dropdown member shows its `name`, an icon shows "?" and is named by its `name`. The action still runs, and the runner is handed no label. A development build logs one warning per component that names the bundle key. The node-level-params warning names a nameless action by its guarded label too. The value is not translated: a locale map stays refused by the contract. A string label renders and translates exactly as before.
