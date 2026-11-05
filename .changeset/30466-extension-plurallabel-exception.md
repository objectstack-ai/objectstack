---
'@objectstack/skills': patch
---

docs(skills): an object extension that renames `label` without `pluralLabel` clears the base plural

Clause-②: no
Metadata-protocol: none

`objectstack-data` § Object Extension Model still says an extension can add but never remove, and now names the one exception the object fold has: an extension that sets a new `label` and no `pluralLabel` takes the base's `pluralLabel` off the served object unless a tenant authored that plural, so an author who renames an object sets both to keep a plural. An extension that repeats the label it extends removes nothing. The Lifecycle Hooks pointer line drops its second link to `references/data-hooks.md`, which the catalog list and the backfill paragraph already link. No schema, key or behaviour changes.
