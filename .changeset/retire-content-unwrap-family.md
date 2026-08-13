---
"@objectstack/plugin-email": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
---

fix(plugins): a declared item reaches its schema intact — retire the `i?.content ?? i` unwrap from plugin read paths (#8378)

Ten production reads over `SchemaRegistry.listItems` unwrapped every declared
item as `i?.content ?? i`, presuming a `{ name, content }` storage envelope.
That envelope has **no producer**. Re-measured at these seams rather than
inherited from #7519's measurement of `MetadataFacade`:

- `registerMetadataCollections` (objectql) registers each stack-collection
  element as-is — `registerItem(type, item, 'name')`, no boxing;
- `loadMetaFromDb` registers `convertStoredItem(JSON.parse(record.metadata))` —
  the parsed body, never the `sys_metadata` row (whose body column is
  `metadata`, not `content`);
- the facade's own interim boxing of non-object values, the one writer that ever
  produced the shape, was removed by #8349.

**Removal is a fix, not a cleanup.** None of the types read through these seams
— `permission`, `position`, `capability`, `object`, `sharingRule`, `webhook`,
`emailTemplate` — declares a stored `content` key; every one of them rejects it
as an unrecognized key. So wherever the key did appear the unwrap replaced a
whole authoring document with one of its values, and `''` — falsy but
non-nullish — passed `??` and then died at the reader's own `filter(Boolean)`,
dropping the item with no warning, no count and no row.

**On email templates the harm was sharpest, and it is the one users will
notice.** `content` really is a spelling an author can write there:
`EmailTemplateDefinitionSchema` lists it in its `strictObject` **aliases** table
(`content: 'bodyHtml'`). That table is a *rejection* facility, not a conversion —
it feeds `strictUnknownKeyError`, which runs only on the `unrecognized_keys`
path and only builds a message; nothing rewrites the key, and the ADR-0087
conversion layer has no `email_template` entry either. The schema was therefore
always ready with the author's fix, and the unwrap was the one thing standing
between the author and it: the HTML string reached
`EmailTemplateDefinitionSchema.parse()`, which answered `Invalid input: expected
object, received string`, and the boot warning's `name` field came back
`undefined` — so an operator could not even tell **which** template had failed.

A template authored with `content` now yields what it was always meant to:

> Unrecognized key(s) on this email template: `content`. Did you mean
> `content` → `bodyHtml`?

…named against the template it came from, and counted as `skipped` rather than
vanishing.

No behaviour changes for spec-valid metadata: the reads hand back exactly the
documents they always did.
