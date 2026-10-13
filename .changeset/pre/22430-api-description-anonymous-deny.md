---
'@objectstack/rest': minor
---

fix(rest)!: the API-description endpoints refuse an anonymous caller

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the two API-description routes that RestServer.registerOpenApiEndpoints mounts (the document and its viewer page), not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and the document a signed-in caller receives is unchanged, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers the two routes serve: a caller with no session is now refused with the shared anonymous-deny 401, a session held by an auth policy gets that policy's 403, and a signed-in caller is served as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`RestServer.registerOpenApiEndpoints` mounts the API-description endpoints: the document and its viewer page. Until now they served a caller with no session, while the data and metadata routes beside them refused one. ADR-0056 D2 denies anonymous callers by default.

- **Refused now:** a caller with no session, with `401` and code `UNAUTHENTICATED` — the same body the data routes answer. Both handlers check before any other work, so the refusal does not say whether a document is bundled.
- **Also refused:** a session held by an auth policy (an expired password, enforced MFA) gets that policy's `403`, as on every other protected route.
- **Unchanged:** a signed-in caller is served the same document and the same viewer page as before. The viewer page loads the document from the browser with the browser's session, so a signed-in browser sees the viewer work as before.

What changes for you. If you published the API description to readers without an account, have them sign in first, or publish a static copy of the document instead.
