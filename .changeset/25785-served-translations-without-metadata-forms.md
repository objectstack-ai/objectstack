---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

**BREAKING** fix(i18n)!: the translation bundle a console downloads leaves out Studio's `metadataForms`

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

`GET /i18n/translations/:locale` served the i18n service's whole locale tree, so every console open downloaded `metadataForms`, the translations of Studio's metadata-type authoring forms: 75 KB of the 221 KB raw zh-CN bundle on `examples/app-crm`. No browser reads that group from the bundle. Studio's forms already arrive translated, because `GET /meta` (and `/meta/types`) resolves `metadataForms.<type>` on the server, from the same i18n service, before it serves each form.

The route now serves every group except the ones the server resolves itself. The spec names them in `SERVER_RESOLVED_TRANSLATION_GROUPS`, which today holds only `metadataForms`. `GetTranslationsResponseSchema.translations` is now `ServedTranslationDataSchema`: the platform face without those groups, and closed, so a body that still carries one fails it. The runtime copies the tree and never edits the service's own one, which is the tree `/meta` translates from. The `ETag` still hashes the bytes served, so a warm reopen still gets `304`.

**Why this is breaking, and why `minor`.** A response body that carries `metadataForms` was accepted by the published `GetTranslationsResponseSchema` and now fails it, the exported `GetTranslationsResponse` type loses that member, and the route stops serving a group it served. The published protocol records the move: the authorable surface gains the served face's keys (`ServedTranslationData`) and `GetTranslationsResponse:requestedLocale`, and the response face a client parses against is narrower, so the kind is `narrowed` and both packages that carry it — the spec that declares the face and the runtime that serves it — ship `minor`. What an author writes into a translation bundle does not move.

**What to do.** Nothing, unless you read `metadataForms` from this route. Read it from `GET /meta/types` instead, which serves each form already translated into the requested locale, rather than from the bundle this route returns. Authoring is unchanged: `metadataForms` stays a group on every bundle face (`TranslationData`, `PlatformTranslationData`), in `i18n:extract` and in the i18n service.

Also on this route: `requestedLocale`, which the door has always served when it fell back to another locale (`zh` served as `zh-CN`), is now declared on `GetTranslationsResponseSchema`, optional. It was served undeclared, so no generated client could read it.

<!-- adr-0087: not-required (no-migration-prescription) The narrowed face is a RESPONSE, and no stored metadata holds one: no package source, stored row or object definition carries a `GetTranslationsResponse` body, so there is nothing for `objectstack migrate meta` to reach or rewrite. What an author writes into a translation bundle is unchanged — `metadataForms` stays declared on both authored bundle faces and in the i18n service, and the authorable-surface keys this diff moves are ADDITIONS (the served face's keys and `GetTranslationsResponse:requestedLocale`), none removed or renamed. The affected party is a code consumer reading this route's answer, whose channel is the compiler and the response schema, not the metadata ledger (ADR-0087 D8), and the remedy is a read from another door (`GET /meta/types`, which serves the same forms already translated), never a conversion between two metadata versions. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the diff touches `packages/spec/**` and a `*.zod.ts` contract face (not type-surface-only); and the narrowed declaration IS a Zod projection, `z.input<typeof GetTranslationsResponseSchema>` (not runtime-interface-only), with no export retired (not runtime-export-retired). -->
