---
'create-objectstack': patch
---

feat(create-objectstack): the blank starter ships an app and a list view, so a new project opens in the Console with its own data

Clause-②: no
Metadata-protocol: none

A project made with `npm create objectstack` used to open the Console on the platform's own apps (Setup, Account) only: the sample `note` object was served over REST and MCP but no app listed it, and the README spent a section explaining that this was not a broken install. The blank template now ships `src/apps/main.app.ts` (an app named `Main` whose navigation opens the notes) and `src/views/note.view.ts` (the notes' list), the files `objectstack generate app main --object note` and `objectstack generate view note` write, with the object referenced as `Note.name` so the project's renamed namespace carries through. The README's Console section now says how to add another object or app, and the steps for deleting the sample object include the view and the app entry.
