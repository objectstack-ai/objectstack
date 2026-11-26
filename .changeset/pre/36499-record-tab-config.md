---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
---

feat(console): an administrator configures the record page's tabs in place, from the record's 「…」

Clause-②: yes (widening)
Metadata-protocol: none

On the record page of an object whose package is writable (an object of a self-built app), a workspace administrator who may author metadata finds 「Configure tabs」 among the record's own entries in its 「…」 (desktop full page only; never on a phone, in a drawer or a pane, or on a page its author composed). Chosen, the page enters an edit state in place: a bar across the top with 「Configure tabs」, 「Cancel」 and 「Save」, in the design mode's bar's look, and the tab row turns into an editor. The record stays on screen as the preview, in the administrator's default order.

In the edit state the related tabs are dragged to a new order, hidden into a 「Hidden」 area and shown again from it, and renamed; the attachments tab can be hidden; 审批 and 动态, which the page always draws last, are shown fixed, and so is a list another package brings. 「Adjust field groups」 opens the object in Studio. 「Cancel」 drops the changes and writes nothing; leaving the page with a change held asks first.

「Save」 writes the object's `relatedLists` over the object as stored (never as served), as a draft with the first-write pin, and publishes it, so everyone sees the new default order, names and hidden tabs. An object's own `relatedLists` hides a tab by leaving it out; an entry the editor does not arrange (a 审批 / 动态 name, a list it does not offer) is kept. A reader's own dragged order still lays over the new default, and 「Restore default order」 returns them to it. A tab is renamed only in the app's source language, where its shown name is its stored one, the design-mode menu's rule.

New language-pack keys under `designMode.recordTabs` in all eleven console locales. `RecordPageColumns` takes an optional `tabRowEditor`, drawn in the tab row's place. Objects of installed (read-only) packages are not offered the entry yet.

`page:header`: a `⋯` entry that finished on the click (it returned no pending promise) now closes the menu, as Refresh does; an entry still running keeps the menu open with its row busy until it settles, as before.
