---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the report name box and the dashboard card title box say when readers are served a translation instead of the saved text

Clause-②: no
Metadata-protocol: none

The report panel (the report page's Edit panel and Studio) and the dashboard card panel (the dashboard page's edit panel and Studio) write a name or title typed in the session language as that language's entry, `{ default: SOURCE, LANG: EDIT }`. The server does not always serve that entry: with no packaged base (an item built in the environment) a translation the environment keeps for that language answers first, and on an installed item a translation the paired `.custom` package ships answers first (ruling record 6631250894's order, unchanged). The box then showed the translation again after Save, with nothing saying why.

A note under the box now says so before Save, from the served text paired with the published one:

- the published name already has its own entry for this language and readers are served another text: the note names that text and says a translation comes ahead of the text saved here, shown before any edit;
- the published name has no entry for this language, readers are served a translation of it, and the box holds an edit: the note names the translation and says readers keep seeing it after Save if it is kept in the environment's own translations or in the customization package.

Both name where to change it: Studio › All metadata › Translation. Save writes no translation row: the console cannot read which translation row answers.

New locale keys: `engine.inspector.servedLabel.kept` and `engine.inspector.servedLabel.ifKept` in the studio catalogue (en, zh). No props or exports change.
