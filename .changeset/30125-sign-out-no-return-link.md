---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(console,auth): after an explicit sign-out, whoever signs in next lands on their own home, not on the page the previous person had open

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/auth`: `AuthContextValue.sessionEndedBySignOut`**, `true` from a `signOut()` until a session is established again in the tab, whoever it belongs to; `false` on load, while signed in, and after a session that ended any other way (expired, revoked, signed out in another tab). It is a new required member of the exported `AuthContextValue` type: code that builds its own value of that type (a test double, a custom provider) must add `sessionEndedBySignOut: false` (or its own reading) to type-check.
- **`@object-ui/console`: `LoginRedirect`** sends the visitor to `/login` with no `?redirect=` after an explicit sign-out. A new member signing in after the administrator signed out of a Setup page used to land on that page and read "you do not have access to this app". A session that expires or is revoked under the person still keeps the path (list state stripped as before), so that person signs back in where they were.
