---
'@object-ui/app-shell': patch
---

fix(app-shell): the AI chat page finds a record's app under a bearer-only session

Clause-②: no
Metadata-protocol: none

- From the AI chat, opening a record (or the form a record-write card proposes) reads the record's object to learn which app it lives under. That read was the bare global `fetch`, carrying the session cookie and nothing else, so a session held by its bearer token alone (the cookie replaced by a second local runtime on the same host, blocked as a third-party cookie, or cleared) was answered `401` and every hand-off opened the record under the Setup shell instead of its own app. The read now goes through the console's authenticated fetch, which sends the stored bearer beside the cookie; a cookie session is unchanged.
- The same-server fetch ratchet loses its AI chat page row, and now also sees a local name bound to the global `fetch` (`const f = fetch`, and in app-shell and the console a `?? fetch` fallback such as `const doFetch = opts.fetchImpl ?? fetch`), so a revert of such a conversion turns it red. A renderer package's `const doFetch = apiFetch ?? fetch` stays its host channel, as the ratchet already documents.
