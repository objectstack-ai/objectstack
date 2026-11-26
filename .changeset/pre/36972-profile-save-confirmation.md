---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(auth, console): saving your name on the profile page keeps the page on screen and shows "Profile updated successfully."; a language save that changes the interface language still confirms

Clause-②: no
Metadata-protocol: none

`useAuth().updateUser` (`@object-ui/auth`) installed the answer of better-auth's `POST /update-user` as the session user. That endpoint answers `{ status: true }`, not the user, so for a moment the signed-in user had no `id`, `name` or `email`: the header showed "?" and "User", and every consumer keyed on the identity dropped its children and mounted them again. In the console the page went blank, its data was read again, and the profile card's success alert, which is local state, was lost. `updateUser` now keeps the same user and applies the fields it wrote to it, the way better-auth builds the stored row. The page is not remounted, and the alert stays. The avatar upload and remove, which call `updateUser` too, no longer blank the page either.

The profile page's Language card (`@object-ui/console`) also confirms a save with a toast. A save that changes the interface language remounts the page under the console shell's language key, by design, and that remount took the card's inline alert with it. The console's toaster sits above that key, so the toast stays. A save that does not change the interface language shows the inline alert as before, and the toast beside it.

Nothing to migrate.
