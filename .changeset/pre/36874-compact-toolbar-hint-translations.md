---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/types': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

fix(i18n): the compact toolbar hint says the same thing in every language

Clause-②: no
Metadata-protocol: none

The `compactToolbar` hint in Studio was reworded in English to say that the compact toolbar draws no Refresh button, so `userActions.refresh` governs only the wide toolbar. The ten translated hints (ar, de, es-ES, fr, ja-JP, ko, pt-BR, ru, zh-CN, zh-Hant) and the console's zh-CN overlay still carried only the old first sentence. They now carry the whole hint.

Each translation names the popover by its own locale's label for the "View settings" button (`list.viewSettings`).

The `compactToolbar` jsdoc in `@object-ui/types` and the `@object-ui/plugin-list` README describe the View settings popover as it is: the view's name, its columns, and Layout, Group, Row height and Row color where offered, with Save, Restore defaults and Export in its footer. Neither lists Refresh there any more: Refresh is a wide-toolbar button only. The view liveness ledger's `userActions` note points at the current `toolbarFlags` lines.

Text only: no schema, key or behaviour change.
