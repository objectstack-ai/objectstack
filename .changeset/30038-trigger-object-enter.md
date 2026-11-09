---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): New automation no longer saves a typed prefix as the trigger object (#30038)

Clause-②: no
Metadata-protocol: none

In Studio's New automation dialog, typing part of an object name and pressing Enter committed the typed text itself, so the flow was created bound to an object that does not exist. The trigger-object picker there now takes objects only: Enter or leaving the field commits the object the text names exactly, else the only match left in the list, else no object, and the picker says no object is chosen. A record preset then keeps the dialog open until an object is picked.

Every other object picker keeps its free text, because a flow reference may hold an expression.
