---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the list title switches views from a dropdown, a pinned view opens by default, and a starred view joins the sidebar's Favorites (#27594)

Clause-②: no
Metadata-protocol: none

- The flat row of view tabs above an object's list is gone. The list title now reads 「<view label> ▾ · <count>」 and opens a dropdown: a search box, then 📌 Pinned, Recent (the reader's last three views of this object) and All (the views the app ships first, then the ones saved at runtime), each row with its view-type icon. New view and, for an admin, Manage views sit at its foot. The split pane beside an open record keeps the same title switcher.
- 📌 on a row makes that view the one this reader's list of this object opens on a bare address; it is kept per object in the workspace preferences of this browser (`list.view.pinned`, scope `object:NAME`). Unpinning goes back to the shipped default view. A view named in the address still wins.
- ☆ on a row stars the view: it appears in the sidebar's Favorites section of the app it was starred in, a click opens it, and the section's starred rows can be dragged (or moved with Space and the arrow keys) into an order that is kept. A view the app's own menu already opens shows its ☆ disabled, 「Already in the menu」. Starred views are favorites of type `view` in the existing favorites store, so they follow the reader across devices like every other favorite.
- Nothing to do: no metadata, protocol or configuration changes. New translation keys sit under `view.switcher` in every language pack.
