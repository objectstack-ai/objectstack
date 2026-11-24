---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): Studio's kanban card "Click to open" offers only Default and "Don't open"

Clause-②: no
Metadata-protocol: none

On an object's list the record name opens the full page and the hover icon opens the side panel, so `navigation.mode` `drawer`, `page` and `new_window` parse there and change nothing; only `none` still counts. The kanban card section of Studio's list-view inspector offered all four. It now offers Default (no key) and "Don't open" (`none`). A view that already stores `drawer`, `page` or `new_window` shows that value flagged "(deprecated)" in the select, and picking Default removes the key. Opening such a view writes nothing. The spec is unchanged, and page blocks that carry `navigation` keep every mode.

The studio catalogue drops the three labels nothing reads any more: `engine.studio.inspector.listView.kanbanCard.mode.drawer`, `.mode.page` and `.mode.newWindow`.
