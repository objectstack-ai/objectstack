---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(i18n): the translation bundle a console downloads leaves out Studio's `metadataForms`

Clause-②: no
Metadata-protocol: none

`GET /i18n/translations/:locale` served the i18n service's whole locale tree, so every console open downloaded `metadataForms`, the translations of Studio's metadata-type authoring forms: 75 KB of the 221 KB raw zh-CN bundle on `examples/app-crm`. No browser reads that group from the bundle. Studio's forms already arrive translated, because `GET /meta` (and `/meta/types`) resolves `metadataForms.<type>` on the server, from the same i18n service, before it serves each form.

The route now serves every group except the ones the server resolves itself. The spec names them in `SERVER_RESOLVED_TRANSLATION_GROUPS`, which today holds only `metadataForms`. `GetTranslationsResponseSchema.translations` is now `ServedTranslationDataSchema`: the platform face without those groups, and closed, so a body that still carries one fails it. The runtime copies the tree and never edits the service's own one, which is the tree `/meta` translates from. The `ETag` still hashes the bytes served, so a warm reopen still gets `304`.

What to do: nothing, unless you read `metadataForms` from this route. Authoring is unchanged. `metadataForms` stays a group on every bundle face and in the i18n service. To show a metadata form in the reader's language, read it from `GET /meta/types`, which serves it already translated.
