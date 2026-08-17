---
'@objectstack/metadata-protocol': minor
---

Derive the metadata reference graph from the type schemas instead of curating it by hand

`GET /api/v1/meta/:type/:name/references` — the admin "Used by" panel, rendered
immediately before a rename or a delete — was driven by a hand-written table of
seven target types and forty dotted paths. Measured against the schemas it was
supposed to describe, **34 of those 40 paths named properties no metadata type
declares**: `app.navItems[]` / `app.tabs[]` (the schema declares `navigation`
and `areas`), `agent.tools[]` (removed in `@objectstack/spec` 17),
`permission.objects[].name` (a name-keyed record, not an array),
`object.fields{}.referenceTo` (the field property is `reference`),
`dashboard.widgets[].view`, `page.viewName`, and every path the table listed for
`flow`. Five of its seven target types therefore answered `{ references: [] }`
unconditionally, on every deployment, while appearing to be covered — and an
empty panel reads as "nothing depends on this, safe to delete".

Coverage is now derived at boot from `DEFAULT_METADATA_TYPE_REGISTRY` and each
type's Zod schema, so a newly declared metadata type arrives covered instead of
waiting for someone to remember it. Seventeen target types now resolve real
reference sites, including `permission`-to-object grants (through the record
key, which the old path grammar could not express), `translation`, `dataset`,
`action`, `report`, `doc` and `datasource`, plus flow-node references such as
`subflow`. References nested inside recursive containers — a view named from a
third-level app navigation group — are found at any depth, which no finite path
list could do.

No wire change: the response shape, status codes and error envelope are
untouched. The `path` and `kind` values now describe where the reference was
actually found rather than which table row matched.

Two gaps are deliberately declared rather than papered over: `external_catalog`
resolves no schema, so its references are not computable and it is named in the
derivation's `unwalkableSourceTypes` (pinned by a test, so the set cannot grow
silently), and reference properties whose name does not spell their target —
`FieldSchema.reference` is the one carried — need a producer-side annotation to
become derivable.
