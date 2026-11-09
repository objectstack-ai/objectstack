---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's action preview draws a param's authored `widget` the way the action dialog draws it (#30117)

Clause-②: no
Metadata-protocol: none

An action param may name a widget (`widget: 'permission-ref'` on a `text` param is the permission-set picker). The action dialog drew that widget, while Studio's action preview read only the param's `type` and drew a text box. The preview now asks the dialog's own adapter which widget it draws, so a `permission-ref` param previews as a picker, and an unregistered widget name previews as the `type` control, the same fallback the dialog takes.
