---
'@object-ui/plugin-list': patch
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

fix(plugin-list): Refresh alone no longer draws the Display entry in the default list toolbar

Clause-②: no
Metadata-protocol: none

The default (Display) list toolbar has no Refresh button, yet `userActions.refresh` still counted as a reason to draw the toolbar's Display entry. On a non-grid view (kanban, calendar and the rest) whose other Display controls were all off, the entry opened a panel holding only its footer. Refresh no longer counts, so such a view draws no Display entry. The wide toolbar (`compactToolbar: false`) still draws Refresh as before, and `userActions.refresh: false` still takes it off there.

`@objectstack/spec`: the `userActions.refresh` description now says the toggle governs only the wide toolbar's Refresh button and changes nothing in the default toolbar. The view form's hint for the key says the same, and `@objectstack/platform-objects` ships it as the English help text in the metadata-forms bundle; the other locales keep their existing translations. Only the description text changed: the key, its type and its default are the same.
