---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): Tab leaves the import wizard's "Save current" reason again

Clause-②: no
Metadata-protocol: none

In the import wizard's mapping step with no column mapped, "Save current" is disabled and a focusable wrapper around it gives the reason in a tooltip. Pressing Tab on that wrapper sent focus to the dialog itself, and the next Tab started over at the template select: a keyboard user could not reach the column-mapping selects, Next, Cancel, Back or Close, and could leave only with Escape. The tooltip's content was mounted inside the dialog and unmounted as the wrapper lost focus; the dialog's focus trap read that removal as the focused element disappearing and pulled focus to the dialog. The tooltip now renders outside the dialog, so Tab and Shift+Tab walk every control in order and the reason is still read out when the wrapper is focused.
