---
'@objectstack/types': patch
'@objectstack/runtime': patch
'@objectstack/plugin-sharing': patch
---

fix(runtime, plugin-sharing): a share link's resolve answer describes the fields it returns — authored label, type, picklist option labels, currency and lookup display bits — so the shared-record page no longer has only the field keys to show (#26991)

Clause-②: no
Metadata-protocol: none

`GET /api/v1/share-links/TOKEN/resolve` answered `{ record, link, redactFields }` on both of its mounts (the `plugin-sharing` routes and the runtime dispatcher's `/share-links` domain). Its visitor is usually anonymous, and `GET /api/v1/meta/object/NAME` refuses an anonymous caller, so a page rendering the shared record could only humanize each key. The answer now also carries `fields`, keyed by field name:

- **What an entry holds.** The field's authored `label` and `type`; a picklist's `options` (`value`, `label`, `color`); `multiple` when it is `true`; a currency field's `currencyConfig` (`currencyMode`, `defaultCurrency`); and a lookup's `reference` (the target object) and authored `displayField`. Labels are the authored ones the object schema holds, untranslated. A lookup's value in `record` is unchanged: the stored id.
- **Which fields.** Exactly the keys `record` carries that the shared object declares. A field the link redacts is absent from both `record` and `fields`; a field the record read never returns (`internal`) is absent from both; no other field of the object is described. The meta door's anonymous refusal is unchanged.
- **One builder.** Both mounts build the whole answer through `buildShareLinkResolveAnswer` (new in `@objectstack/types`, beside `redactSharedRecord` and `projectSharedRecordFields`), so they answer the same shape. Redaction is unchanged.

The existing keys are unchanged, so a reader of the old answer reads the new one as before.
