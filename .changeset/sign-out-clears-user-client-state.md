---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
---

fix(auth,app-shell): every sign-out clears the browser storage the signed-out user's session wrote

Clause-②: no
Metadata-protocol: none

- **`@object-ui/auth`:** every sign-out path clears the `localStorage` and `sessionStorage` keys the session wrote: `signOut()`, and any session read the server answers with "no session" in a browser that has held a session (a session that expired, was revoked or was ended in another tab, at boot or in place). It is the same allowlist sweep a change of session user already runs. The sweep leaves the session token key (`auth-session-token`, which the auth client manages itself), the session-user pointer (`auth-session-user-id`), the theme (`vite-ui-theme`) and the sign-in page language (`objectui-locale`, `objectui-locale-seed`). A session read the server does not answer (a network failure, or an error status other than 401) is not a sign-out and clears nothing. Server-side user preferences are not changed. A host that keeps its own setting in browser storage under another key finds it cleared at sign-out, as it already was when a different user signed in.
- **`@object-ui/app-shell`:** a list's search write still waiting on its debounce is dropped before `signOut()` ends the session, and as soon as a session ends any other way, so none is written after sign-out.
