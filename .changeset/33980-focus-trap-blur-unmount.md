---
'@object-ui/console': patch
'@objectstack/console': patch
'@object-ui/plugin-grid': patch
---

fix(console): Tab no longer gets stuck in a dialog on a control whose tooltip closes as it loses focus

Clause-②: no
Metadata-protocol: none

Inside a dialog, sheet or alert dialog, pressing Tab on a control that shows a tooltip while focused sent focus back to the dialog itself, and the next Tab started over at the first control. In the Manage Views dialog a keyboard user could not get past the first view's Pin button: the other views, their Set-as-default and menu buttons, and Done were unreachable. The tooltip closes as the control loses focus, and the dialog's focus trap read the closing tooltip as the focused control disappearing. The trap now pulls focus back only when the control that had focus really is gone, so Tab and Shift+Tab move on from every such control, in every dialog. The import wizard's own workaround for the same problem, which rendered its "Save current" tooltip outside the dialog, is removed: the tooltip renders inline again and Tab still moves on.
