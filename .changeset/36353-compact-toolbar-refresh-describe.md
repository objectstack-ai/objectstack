---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

docs(spec): the `compactToolbar` describe says which toolbar is the default and that it draws no Refresh

Clause-②: no
Metadata-protocol: none

The `compactToolbar` description on a list view (and the view form's hint for it, which mirrors it) now says what a renderer does when the key is omitted and which toolbar `userActions.refresh` applies to: the compact toolbar (the View settings popover) is on by default, omitted or `true`; `false` draws the wide toolbar, one button per control. The compact toolbar draws no Refresh button, so `userActions.refresh` governs only the wide toolbar; pull-to-refresh is unaffected by either key. This matches the `userActions.refresh` description, which already scopes the toggle to the wide toolbar.

Description text only: the key, its type, its optionality and the accepted values are unchanged, so every view that parsed before parses the same. The generated reference pages and the English metadata-forms help text carry the new sentence; the translated help texts keep their current wording.
