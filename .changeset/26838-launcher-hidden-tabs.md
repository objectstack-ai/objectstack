---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): Home, the app switcher and the `app:launcher` block no longer offer an app the user's permission sets hide

Clause-②: no
Metadata-protocol: none

A permission set's `tabPermissions: { APP: 'hidden' }` hides an app from the member's launcher. The server applies that hide in one place, `GET /api/v1/me/apps`, and the console never read it: Home's tiles, the app switcher's menu and the `app:launcher` page block all listed `GET /api/v1/meta/app`, which still serves the hidden app because a hidden app keeps opening from a direct URL. So the member saw, and could open, the tile their admin had hidden.

What changes:

- The console reads `GET /api/v1/me/apps` once per user, beside its `/auth/me/permissions` read, and every launcher surface narrows its `/meta/app` list by that answer's app names. The tiles keep the labels, icons and publish state `/meta/app` serves.
- An app the answer was not asked about is not hidden by it: an app that is installed or published after the read stays on the launcher, and the console asks again.
- Home waits for the first answer, as it waits for the app list, so a hidden tile is never drawn and then removed.
- A deployment without the security plugin answers `404` there; the launcher then lists every app the user can open, as before. Any other failure does the same and says so once on the browser console.
- A hidden app still opens from its URL, and the switcher still names it while the user is in it. `default_off` is not a hide and changes nothing.

What to do: nothing. A permission set that already hides an app now hides it on Home, in the switcher and in launcher blocks.
