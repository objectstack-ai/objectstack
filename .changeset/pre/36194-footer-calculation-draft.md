---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a footer calculation is a part of the list's draft; a refused save of a package's view says why in the reader's words

Clause-②: yes (widening) — new keys in every `@object-ui/i18n` locale pack: `console.objectView.personalizedParts.summaries` and `console.objectView.saveRefused.packaged`; nothing removed or renamed
Metadata-protocol: none

On a Console object list, picking, changing or removing a column's footer calculation (「+ 添加统计」) applies at once and writes nothing. It used to be saved at once: on the reader's own view straight into it, on a shared view as a draft of the view (`PUT /api/v1/meta/view/<name>?mode=draft`), which the server refuses on a view an app package ships.

- The calculation is a part of the list's draft, like the sort and the filter: **Discard** and **Save** appear, Save's menu names it (「统计」), and Discard takes it off. The draft lives as long as the others: kept on opening a record and coming back, dropped on another view, object or a reload.
- **Save to this view** (on the reader's own view, or on a shared view an admin may edit) and **Save as my view** store it on the columns the saved view keeps.
- **Save to this view** on a shared view is offered only once the Console has read that the view's package takes saves: not while that read is in flight (on a slow start the list draws seconds before it lands) nor for a package it lists read-only. A failed read, or a package the list leaves out, still offers it as before.
- On a view the reader cannot change in place (one an app package ships, or a shared view of a reader who is no admin), the pick goes into the draft too and Save offers **Save as my view** alone.
- The menu is offered on every column the saved view would carry: the columns the list draws and the fields the reader added.
- When the server refuses to save a view an app package ships (`NOT_OVERRIDABLE`), the toast says in the reader's language that the view comes with an app package, cannot be changed directly and can be saved as the reader's own view. The server's text goes to the console only. Every other refusal is said as before.
