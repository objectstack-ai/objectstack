---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

feat(metadata): the layered read takes the bundle member selector, so the layers of one locale of an `email_template` can be read

Clause-②: yes
Metadata-protocol: added

`GET /api/v1/meta/:type/:name/layers` and the protocol's `getMetaItemLayered` now accept `member`, the same bundle member selector the by-name read, delete, publish, history and revert already take. Before, the layered view only ever showed the canonical member (`en-US` for `email_template`) and refused `?member=` with 400, so an editor built on it could not open a second locale of a template.

- **Named the same way.** `?member=` on the REST route and `member` on `GetMetaItemLayeredRequest` (`@objectstack/spec`), spelled as the member's discriminator value (`zh-CN`). Absent, the canonical member's layers, as before; naming the canonical value is the same request.
- **Every layer is that member's.** `code` is the package's artifact for that member, `overlay` the environment's stored row for that member, and `effective` what the by-name read with the same `member` serves. A member with nothing shipped and nothing stored answers `404`, the absent item, never the canonical member's layers.
- **Refused as the item read refuses it.** A `member` on a type whose identity is its name alone (every type but `email_template` today), a blank one, or one over 100 characters is a `400 VALIDATION_ERROR` naming the selector. A repeated `?member=` is refused by the multiplicity rule.
- **Both transports.** `RestServer`'s route and the runtime dispatcher's `/meta` catch-all judge the route's query through the one shared decision (`metaItemQueryRefusal('layers', …)` in `@objectstack/rest`), whose closed set for the route is now `package` and `member`. `META_ITEM_LAYERS_PARAMS` reads `['package', 'member']`.
- **Unchanged.** The deprecated `?layers=` flag on the plain read still refuses a `member` beside it; read one member's layers on `/layers` instead.
