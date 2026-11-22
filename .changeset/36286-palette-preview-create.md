---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the ⌘K palette previews the record it is on, creates a record from what you typed, finds "New OBJECT", and says what Enter does

Clause-②: no
Metadata-protocol: none

The command palette inside an app gains four things; which records it searches, and how it ranks them, are unchanged.

- **Record preview.** While the query finds records, the palette widens and shows the selected hit on the right, read-only: the object's label, the record's title and the object's declared key fields (`highlightFields`), drawn the way the record pointer card draws a record (field-level security applied; an object that declares no key fields shows its title alone). Arrow keys move the preview with the selection; the record is read once the selection rests for 150 ms. A palette narrower than 45rem (720px) shows the results alone.
- **Create "words" as OBJECT.** Once something is typed, the end of the list offers to create a record of up to three of the app's objects, the object of the page the palette was opened on first, with the typed words in the object's title field: Enter opens that object's create page (`/apps/APP/OBJECT/new`) with the field filled. An object is offered only where its list offers New (the same verdict: CRUD bucket, `userActions.create`, effective API operations, the create grant, and the create action's `visibleWhen` / `disabledWhen`), and only when its title field is a text field the member may write on create.
- **New OBJECT.** Typing "new", "create" or an object's name finds a "New OBJECT" entry for each such object, which opens its empty create page.
- **Enter hint.** A footer names what Enter does to the selected entry: Open record, Create, Switch app, Apply theme or Open.

New locale keys, in every pack: `console.commandPalette.create`, `createAs`, `previewEmpty`, `enterOpenRecord`, `enterCreate`, `enterSwitchApp`, `enterApplyTheme`, `enterOpen`. No props or package exports change.
