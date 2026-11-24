---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/plugin-list': patch
---

feat(console): a change on a list is a draft, with Discard and Save

Clause-②: yes (widening) — new `console.objectView.draft.*` keys in every `@object-ui/i18n` locale pack (`discard`, `discardTitle`, `save`, `heading`, `partSeparator`, `saveToView`, `saveAsMyView`, `copyName`, `saved`); nothing removed or renamed
Metadata-protocol: none

On a Console object list, a header sort, a filter change, grouping, the search, Hide Fields, an added field and a column drag apply at once and are now a draft: they are kept nowhere. They used to be saved at once into the reader's own list preference (`sys_user_preference`, key `ui.list.<object>`) and followed them to every device.

- While the list holds a draft, **Discard** and **Save** sit at the end of the condition row, where the 「Personalized · Reset to view」 marker was. On a narrow list or a phone they fold into one **Save** whose menu also holds Discard.
- **Save** names what is unsaved and offers **Save to this view** (on a view of the reader's own) and **Save as my view**, which asks a name first (the view's name with "copy"), saves the draft as a new view of the reader's own and opens it. Either says "Saved", and the buttons go while the conditions stay.
- **Discard** puts the list back as its view declares it and removes the list's `uf_*` parameters from the address bar.
- Where the reader may not save (no personal view can be created or updated), both faces are Discard alone.
- The draft survives opening a record (as a page or in the side panel) and coming back. Opening another view or object, or reloading the list's page, drops it. A reload of another page does not drop the state an in-app link to a list carries.
- Column widths, the row height and the views' order are not a draft. They are still remembered for the reader in the same `ui.list.<object>` row.

Upgrade note: a sort, filter, search, column order, hidden column or added column that an earlier Console stored in a reader's `ui.list.<object>` row no longer applies; the list opens as its view declares it. Nothing stored is deleted by this change; a later column-width change rewrites that row's column state with the widths alone. A reader who wants such a list kept saves it as a view of their own.

Saving into a shared view, and saving the Display panel's layout and row colour, are not offered yet. `@object-ui/plugin-list` changes only its README, which now describes added fields as part of the draft. No metadata key, value or default changes.
