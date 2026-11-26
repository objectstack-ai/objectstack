---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a stored settings select, radio or multiselect value the setting no longer offers reads as "no longer available" instead of nothing chosen

Clause-②: no
Metadata-protocol: none

When a settings select's stored value is not among the options the setting declares today (an option removed in a later release, such as the knowledge adapter `ragflow`), the Setup select showed an empty box: no label and no placeholder. It now shows the stored code with a mark, for example "ragflow (no longer available)", as one disabled entry in the list. A radio group shows the same text as one checked, disabled item. A multiselect shows each stored member outside the options as a checked checkbox with the same text: ticking a current option keeps the member in the saved list, as before (and the server still refuses a save of that list while it holds one); unticking it removes it, and it cannot be ticked back. The admin can still pick a current option, which saves as before; the retired entry cannot be picked back. Values among the options, and an unset value, render as before.

New locale key: `console.settingsView.selectValueRetired` (`{{value}}` is the stored code), in all eleven Console language packs. No props or exports change.
