---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

feat(metadata-protocol): a metadata write's advisories and refusals come back in the caller's language

Clause-②: yes (widening) — `SaveMetaItemRequestSchema`, `PublishMetaItemRequestSchema` and `PublishPackageDraftsRequestSchema` gain an optional `userTextLocales` member (at most two locale codes), and `ExecutionContextSchema` gains an optional `workspaceLocale`. Nothing that was accepted before is refused now; a request that states no locales composes in `en`, and a finding whose rule has no user sentence carries no `userMessage`, exactly as before.
Metadata-protocol: added

Ruling C on #32440: the producer of a finding writes its user-facing sentence in the request's language, else the workspace's default language, else English, and every client shows it as received. The authoring rules already carry a sentence in twelve languages for most findings (#32790); this change composes it on the server:

- Every `/meta` save, single-item publish and package publish now fills `userMessage` on each advisory, and on each issue of a 422 refusal, for a rule that has a user sentence. `rule`, `message`, `hint`, `path` and `where` are unchanged.
- The door states the two languages it resolved: the request's own (its `Accept-Language` header or `locale` query) and the workspace default. The execution context used to fold them into one `locale`, so a request in a language the platform has no text in fell straight to English; it now carries the workspace default on its own as `workspaceLocale`, and the core helper `userTextLocalesOf(ctx)` reads the pair in order.
- The REST server and the runtime dispatcher both state them, for saves, publishes and package publishes.

Not in this change: the refusal sentences written outside the authoring rules (the packaged permission-set lock, the permission middleware's denials) move onto the same ladder in a follow-up PR on #32656.
