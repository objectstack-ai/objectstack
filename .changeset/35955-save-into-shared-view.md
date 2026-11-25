---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/plugin-list': patch
---

feat(console): Save to this view on a shared view asks once, then saves and publishes it; the layout and row colour are part of a list's draft

Clause-②: yes (widening) — new `console.objectView.draft.*` keys in every `@object-ui/i18n` locale pack (`saveToViewConfirmTitle`, `saveToViewConfirm`, `saveToViewConfirmButton`, `savedForEveryone`, `pendingDraft`); `@object-ui/plugin-list` `ListView` gains the optional host prop `onRowColorChange` and two optional `viewDefaults` members, `viewType` and `rowColor`; nothing removed or renamed
Metadata-protocol: none

On a Console object list, **Save to this view** is now offered on a shared view to a reader who may edit it (an administrator, on a stored view whose package takes saves). It asks once ("everyone who uses this view will see these changes"), then saves the view and publishes it in the same step, so other readers see it on their next read, and says "Saved, visible to everyone". The options menu's Save does the same.

- When the view already has unpublished changes (a draft saved from the view settings, by anyone), nothing is written: the Console says so and points to the view settings to publish or discard that draft first. The draft write is sent with the first-write pin (`If-None-Match: *`), so the server refuses it when a draft is pending; that draft is never published on someone else's behalf. A publish the server refuses discards the draft the save wrote.
- The reader's row height and column widths are never written into a shared view: it keeps its own.
- The Display panel's layout and row colour are part of the list's draft: they survive opening a record and coming back, and both Save to this view and Save as my view keep them (a layout switch retypes the saved view). Discard puts back the view's own.

`@object-ui/plugin-list`: `ListView` reports a pick in its row colour panel through the new optional host prop `onRowColorChange` (the rule in force, or `null` for none), never at mount or for a reset. A host that lays the reader's layout or row colour into `schema` passes the view's own in `viewDefaults.viewType` / `viewDefaults.rowColor`, and the `layout` / `rowColor` parts and the Display count are judged against them; each is read only when its key is present. Without them nothing changes.

No metadata key, value or default changes. The view settings panel and the footer calculation still save a shared view as a draft that the view settings publish.
