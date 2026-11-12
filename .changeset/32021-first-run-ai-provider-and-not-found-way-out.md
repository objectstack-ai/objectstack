---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the first-run checklist shows the AI provider the server is running and folds the rows that are done; every "not found" page now has a way back

Clause-②: yes (widening)
Metadata-protocol: none

What an administrator sees on Home, and what anyone sees after following a stale link (objectstack#32021 item 4, objectstack#32157):

- **The built-in AI on the first-run checklist.** A new row, "Set up the built-in AI", reads `live.provider` from `GET /api/settings/ai`. That field says which provider the running system uses and where it came from. The row never reads `values.provider`, because that only says what was saved, and the runtime can detect a provider from its own boot environment while nothing is saved. When a provider is in use, the row is done and names it by its option label, followed by "set in Setup" or "detected from the server environment". When `source` is `none`, the row is not done and links to Setup → AI & Embedder. A server that does not state the provider at all draws no row, because unknown is not the same as unset. Only a session that may write the `ai` namespace reads it. The external assistant row keeps its wording and stays a separate step.
- **Rows that are done are folded away.** The checklist now draws only the rows still to do. Under them, one control ("Show completed (N)" / "Hide completed", with `aria-expanded`) shows the done rows in their place or folds them again. Every visit starts folded, so the card keeps the first screen for the work left. Progress still counts every row.
- **A way back from every not-found page.** Four pages now share one `NotFoundState`, each keeping its own title and cause: unknown object, unmatched URL, unknown record and unknown app. Each page offers its own way back first, then "Back to home", which goes to the deployment's declared landing app when it has one. For an unmatched URL that is "Go back". For an unknown record it is "Back to OBJECT-LIST", a link to the object's list. For an unknown app it is "Retry". Before this change, the unknown-object and unknown-record pages offered no way out. The "no access to this app" page uses the same Home button.

New `@object-ui/i18n` keys in every pack: `console.firstRunChecklist.aiProvider.{title,todo,doneSettings,doneEnvironment,action}`, `console.firstRunChecklist.{showDone,hideDone}` and `empty.backToList`. No key is removed or renamed.
