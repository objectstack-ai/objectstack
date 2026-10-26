---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

**BREAKING** fix(i18n)!: the translation bundle a console downloads leaves out Studio's `metadataForms`

Clause-②: yes (narrowing)
Metadata-protocol: none

`GET /i18n/translations/:locale` served the i18n service's whole locale tree, so every console open downloaded `metadataForms`, the translations of Studio's metadata-type authoring forms: 75 KB of the 221 KB raw zh-CN bundle on `examples/app-crm`. No browser reads that group from the bundle. Studio's forms already arrive translated, because `GET /meta` (and `/meta/types`) resolves `metadataForms.<type>` on the server, from the same i18n service, before it serves each form.

The route now serves every group except the ones the server resolves itself. The spec names them in `SERVER_RESOLVED_TRANSLATION_GROUPS`, which today holds only `metadataForms`. `GetTranslationsResponseSchema.translations` is now `ServedTranslationDataSchema`: the platform face without those groups, and closed, so a body that still carries one fails it. The runtime copies the tree and never edits the service's own one, which is the tree `/meta` translates from. The `ETag` still hashes the bytes served, so a warm reopen still gets `304`.

**Why this is breaking.** A response body that carries `metadataForms` was accepted by the published `GetTranslationsResponseSchema` and now fails it, the exported `GetTranslationsResponse` type loses that member, and the route stops serving a group it served. Nothing an author writes moves, which is why the kind is `none` and the level is `patch`.

**What to do.** Nothing, unless you read `metadataForms` from this route. Read it from `GET /meta/types` instead, which serves each form already translated into the requested locale, rather than from the bundle this route returns. Authoring is unchanged: `metadataForms` stays a group on every bundle face (`TranslationData`, `PlatformTranslationData`), in `i18n:extract` and in the i18n service.

Also on this route: `requestedLocale`, which the door has always served when it fell back to another locale (`zh` served as `zh-CN`), is now declared on `GetTranslationsResponseSchema`, optional. It was served undeclared, so no generated client could read it.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves for an upgrading author: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and `metadataForms` stays declared on both authored bundle faces and in the i18n service, so there is nothing for `objectstack migrate meta` to reach or rewrite. What narrows is one HTTP answer's shape — the console bundle no longer carries a group the server resolves itself — and the affected party is a code consumer reading that answer, whose channel is the compiler and the response schema, not the metadata ledger (ADR-0087 D8). The remedy is a read from another door (`GET /meta/types`, which serves the same forms already translated), never a conversion between two metadata versions. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); the diff touches `packages/spec/**` and a `*.zod.ts` contract face (not type-surface-only); and the narrowed declaration IS a Zod projection, `z.input<typeof GetTranslationsResponseSchema>` (not runtime-interface-only), with no export retired (not runtime-export-retired). -->
