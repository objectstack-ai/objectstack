---
'@object-ui/components': patch
---

fix(components): an `action:button` whose label is not a string renders no text instead of crashing the page

Clause-②: no
Metadata-protocol: none

The `action:button` `label` is a string, localized through the translation bundle entry for the component id (`pages.PAGE.components.COMPONENT_ID.label`). A non-string label, such as an inline locale map from code-registered page metadata that never passed `validateComponentProps`, used to throw "Objects are not valid as a React child" and white-screen the whole page. The button now renders with no text and still runs its action. Every read of the label goes through the same guard, including the auto-trigger refusal notice, so `[object Object]` is never shown. A development build logs one warning per component that names the bundle key. A numeric label, which the contract also refuses, used to render as text and is now dropped with the same warning. The value is not translated: a locale map stays refused by the contract. A string label renders and translates exactly as before.
