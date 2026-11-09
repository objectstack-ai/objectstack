---
'@object-ui/auth': patch
---

fix(auth): the sign-in page reads the sign-in methods the server has now, not the ones it had when the tab was opened (#30299)

Clause-②: no
Metadata-protocol: none

The auth client kept the first `/auth/config` answer for the life of the page. An administrator who turned email and password off on the Authentication settings page (with another way in configured) and then signed out was shown the email and password form on the sign-in page, from the copy read while signed in, although the server refuses that form. The client now forgets the cached config whenever the tab is left without a session: on sign-out, and when a session read finds none (an expired session reaches the sign-in page without a sign-out). Readers on one page still share one request, and nothing changes while a session lasts.
