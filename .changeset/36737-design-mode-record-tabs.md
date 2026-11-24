---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a record page's tabs are arranged in the design mode, under its one bar; a list's draft actions read Reset / Update view

Clause-②: no
Metadata-protocol: none

The design mode and the record page's 「Configure tabs」 each drew a purple bar with its own Cancel and Save, and the two stacked when both were open. A list's draft actions (Discard / Save) showed under the design mode's bar as a second page save. Following Twenty's grouping (the maintainer's ruling 「照 Twenty 归类」):

- The record page's tabs are part of the design mode. While the mode is on, the tab row of a record's desktop full page is the tabs editor in place, for an administrator who may arrange that object's tabs (the same gates as before: a workspace administrator who may author metadata, the desktop full page, not a drawer or pane, not an authored page, and the customization-door wall on an installed object). The draft is staged with the mode's other changes (the app menu, the header buttons): the mode's Save writes it with them, to the object's own package (`relatedLists`, published) or, on an installed object, to the base's paired `.custom` object extension, as before; the mode's Cancel drops it. The draft stays staged while the administrator moves to another page of the app. The record's ⋯ no longer offers 「Configure tabs」, and the separate 「Configure tabs」 bar is gone. A failed save says so through the mode's own message and keeps the draft staged.
- A list's draft actions are the view's own, as Twenty's 「Reset / Update view」: they now read 「重置 / 更新视图」 (en: Reset / Update view; every bundled language pack is updated), and they stay drawn and live while the design mode is on. The Update view menu keeps 「Save to this view」 and 「Save as my view」.

Locale values changed in `@object-ui/i18n` (no key added or removed): `console.objectView.draft.discard` and `console.objectView.draft.save`, in all eleven bundled packs. No props or package exports change.
