---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): a settings field an environment variable pins offers to clear the value saved beneath the pin

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/console`:** on a Setup settings page, a field an `OS_*` environment variable pins still shows the lock badge and stays read-only. When the namespace read lists a value stored beneath the pin at the scope the page writes (a secret's as the read mask), the row also says that a value is saved there and that the environment value stays in force, and offers "Clear the saved value". The control asks first, then writes `null` for that one key, the one write the server lets through a pin; the page's unsaved edits are left as they are. After the clear the row still reads the environment value, and the saved value no longer comes back when the variable is removed. A pinned field with nothing stored at that scope, a field no variable pins, and the first-run checklist show no control.
- **`@object-ui/i18n`:** four new `console.settingsView` keys in all eleven packs: `savedBeneathPin`, `clearSaved`, `clearSavedConfirm` and `savedCleared`.
