---
'@objectstack/rest': patch
---

The API-description endpoints refuse an anonymous caller

Clause-②: no

`RestServer.registerOpenApiEndpoints` mounts the API-description endpoints: the document and its viewer page. Until now they served a caller with no session, while the data and metadata routes beside them refused one. ADR-0056 D2 denies anonymous callers by default.

Both handlers now start with the same anonymous-deny check the data routes use, before any other work. An anonymous request gets `401` with code `UNAUTHENTICATED`, the same body the data routes answer. A signed-in caller is served as before. A session held by an auth policy (an expired password, enforced MFA) gets that policy's `403`, as on every other protected route. The viewer page loads the document from the browser with the browser's session, so a signed-in browser sees the viewer work as before.

If you published the API description to readers without an account, have them sign in first, or publish a static copy of the document instead.
