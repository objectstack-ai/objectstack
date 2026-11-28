---
'@object-ui/data-objectstack': patch
---

fix(data-objectstack): `uploadFile` and `uploadFiles` send through the injected `fetch`, not the global one

Clause-②: no
Metadata-protocol: none

The two upload methods called the global `fetch`, which sends the session cookie alone. A host that hands the adapter its authenticated fetch (the console hands `createAuthenticatedFetch()`) had every other request signed with the stored bearer, while an upload under a bearer-only session (the cookie replaced, blocked as third-party, or cleared) went out anonymous. Both methods now call the injected `fetch` as given. They still sit outside the connection-state tracking, so an upload's outcome does not move the connection state, as the README already says. The request URL, body and headers are unchanged.
