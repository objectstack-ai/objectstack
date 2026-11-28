---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a metadata form row hidden by `visibleWhen` stays drawn while its key holds a value

Clause-②: no
Metadata-protocol: none

In the Studio metadata forms, a row whose `visibleWhen` turned false disappeared even when the draft still held a value for it. In the hook editor, an author who declared a refusal on a JavaScript body and then switched the body to an expression lost sight of the refusal, and the save was refused at a key the form no longer showed. Such a row now stays drawn. It says that its value does not apply to the current settings and may make the save fail, and it offers a "Clear value" button. Once cleared, the row hides as before. Nothing the author entered is dropped without that click, which is the rule the flow node inspector already follows. A row whose predicate is false and that holds no value is hidden exactly as before. What a metadata author can write does not change.
