---
'@objectstack/runtime': minor
---

fix(runtime)!: the `/i18n` dispatcher domain refuses a caller without a session with `401 UNAUTHENTICATED`, like every other dispatcher domain

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the dispatcher's /i18n domain handler (handleI18nRequest), not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and what a signed-in caller receives is unchanged, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers the domain serves: a caller with no session is now refused with the shared anonymous-deny 401 before the domain reads anything. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this domain and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The `/i18n` dispatcher domain serves the application's translations: the locale list, the translation bundle and the field labels. The bundle carries the labels of every object, field, app and page the application declares. Until now the domain served a caller with no session, while the metadata read of the same objects refused one. ADR-0056 D2 denies anonymous callers by default.

**What changed.** The domain handler opens with the shared anonymous-deny decision (`shouldDenyAnonymous`), the same floor the `/meta`, `/actions`, `/automation`, `/packages` and `/analytics` domains stand on. It is the handler's first statement:

- every face of the domain answers a caller without a session `401` with code `UNAUTHENTICATED`, in the dispatcher's wrapped envelope (`{ success: false, error: { code: 'UNAUTHENTICATED', message, httpStatus: 401 } }`), and serves nothing of the bundle;
- it runs before the i18n provider is looked up, so the answer is `401` whether or not a provider is installed, never the `501` an empty slot answers;
- it runs before a face reads its parameters, so a request that leaves out its locale is `401`, never the `400` that face answers.

**What is not affected.** A signed-in caller, an API-key caller and an internal system context are served exactly as before: the same bundle, the same `400` for a missing locale, the same `501` when no provider is installed. A CORS preflight is unchanged.

**The Console.** The Console this release pins renders its sign-in page from its built-in language packs and loads the application's translations after sign-in, with the signed-in session. A signed-in Console user sees the application's labels as before.

**If you read `/i18n` from your own client,** send the signed-in user's session or bearer token, or an API key, with the request. Render anything shown before sign-in from strings your client ships, and load the application's translations once the user has signed in.
