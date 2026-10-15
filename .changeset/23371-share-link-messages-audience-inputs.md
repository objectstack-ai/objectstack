---
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
---

fix(plugin-sharing, runtime): a shared conversation's messages open for exactly the callers its share link opens for, on both mounts

Clause-②: no — `/messages` now reaches the answer `/resolve` already gives the same caller for the same link, on the same mount; who can open a share link is unchanged.

A share link to an AI conversation has two public routes: `/resolve` returns the conversation, and `/messages` returns its messages. Both check the link through the same service call. `/resolve` passed it every input an audience is judged by. `/messages` passed fewer, so it refused callers `/resolve` served:

- **A `signed_in` link, a signed-in caller:** plugin-sharing's share-link routes answered `/messages` with `404 NOT_FOUND`, so the console's shared-conversation page showed the conversation with no messages. It now returns the messages, as the runtime dispatcher's share-links domain already did.
- **An `email` link, an allowlisted `?email=`:** both mounts answered `/messages` with `404 NOT_FOUND`. Both now read `?email=` on `/messages` exactly as on `/resolve`, and return the messages.
- **Unchanged:** every caller `/resolve` refuses is still refused on `/messages` with `404 NOT_FOUND`: an anonymous caller of a `signed_in` link, and a caller of an `email` link with no email or an off-list email, signed in or not. A password-protected link still needs its password on both routes. `/resolve` is unchanged.
