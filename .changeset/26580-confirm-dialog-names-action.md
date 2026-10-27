---
'@object-ui/core': patch
---

fix(core): a declared action's confirm dialog is titled with the action's label, and a danger action's confirm button is destructive

Clause-②: no
Metadata-protocol: none

Before, clicking an action that declares `confirmText` always opened a dialog titled 「确认操作」 / "Confirm Action" with a neutral 「继续」 / "Continue" button: the action's own label and its `variant: 'danger'` never reached the dialog. `ActionRunner` now hands its `ConfirmationHandler` the existing `options` bag:

- `title` and `confirmText` are the action's `label`, already localized by the surface that dispatches it.
- `destructive: true` when the action declares `variant: 'danger'`, which paints the console's confirm button in the destructive style, as the record Delete already does.
- The cancel button keeps the host's own copy. An action with neither a label nor the danger variant is asked with the message alone, as before.

What to do: nothing. No key is added; the action already declares its label and variant. A custom `ConfirmationHandler` that ignores its second argument behaves as before.
