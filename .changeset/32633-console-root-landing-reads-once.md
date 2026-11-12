---
'@object-ui/console': patch
---

fix(console): opening the Console at its root asks `/meta/app` and the boot preference read once, not twice

Clause-②: no
Metadata-protocol: none

Opening the Console at `/_console/` (a bookmark, the post-sign-in landing) resolved the landing app in one data shell and then mounted a second one for the app it redirected to, so `GET /api/v1/meta/app` and the boot `sys_user_preference` read went out again, one round trip later. The root now resolves the landing in the same shell the app page uses, so each of those reads goes out once, the same as opening the app page directly. Where the root lands is unchanged, and so is the organization check: a session with no active organization is still sent to the organization picker by the page it lands on.
