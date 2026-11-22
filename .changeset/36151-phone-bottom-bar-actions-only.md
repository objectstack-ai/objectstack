---
'@objectstack/spec': minor
'@object-ui/components': minor
'@object-ui/app-shell': minor
---

feat(record-page): on a phone the record page's bottom bar holds the object's own actions only, and Edit moves into the More menu at the top bar's right end

Clause-②: yes (widening)
Metadata-protocol: semantic

On a phone the record page's bottom bar used to always draw Edit first, then the primary action and the `⋯`; an object with no action of its own got a full-width Edit and nothing else. A field's value is now edited by a tap on it, so on a phone:

- The bottom bar draws the object's actions only: the primary and the next one (the default budget of 2 is unchanged), filling the row. The record's edit state keeps its Cancel and Save there.
- With no action to draw, no bottom bar is drawn and the page body runs to the foot of the screen.
- The `⋯` moves to the right end of the top bar. It holds Edit (on or off, with the reason when it is off), the actions that did not fit, Refresh, Share and Delete. (Favorites is not in it: the favorite star sits beside the record's name.) Edit there does what the bar's Edit did.
- A record pending the reader's approval is unchanged: the bar is the approval's decisions and its own `⋯`.
- The desktop header is unchanged.

`page:header` `mobileMaxVisible` keeps its default of 2 in the phone bar, but Edit no longer takes one of those slots, so an unset budget now shows two of the page's actions where it showed one, and an authored value counts the page's actions alone. Host buttons still take bar slots ahead of the page's actions: the queue's Claim, and in the record's edit state its Cancel and Save. Its description in the spec, the designer and the docs says so.

Migrating: an author who wants the earlier number of page actions in the phone bar lowers `mobileMaxVisible` by one. An authored `1` that meant "Edit only" now shows the primary action; to keep the bar free of inline actions, mark the page's actions `component: 'action:menu'` so they fold into the `⋯`.

`@object-ui/components`: `PageHeaderPhoneFace` (the value of `PageHeaderPhoneContext`) gains an optional `more` slot. A host that hands it gets the `⋯` drawn there, and a bar with no button draws nothing; a host that does not keeps the `⋯` as the bar's last button, as before.
