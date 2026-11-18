---
'@object-ui/app-shell': patch
---

fix(studio): the Studio landing's own-app cards show the app, not its package id, and 最近访问 is left out when it only repeats them

Clause-②: no
Metadata-protocol: none

Two changes on the Studio landing page (`/studio`):

- **自己的应用 / Your own apps cards.** A card shows the app's name only. The package id line under the name (for example `app.nb57`) is gone, and so is the 可写 / "Writable" badge: every app in this section is writable, so the badge said nothing. The package id is still on the card's hover title, the way an installed app's card already carries it.
- **最近访问 / Recently viewed.** The row is left out when its entries are exactly the apps the cards above already show, for example one recent visit to the only app on the page. It is drawn whenever it adds something: an app no card shows, or a card it does not repeat.

No layout or feature change: the cards, the Duplicate button, the create card and the other sections are as before. No locale keys change.
