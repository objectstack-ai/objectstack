---
'@objectstack/metadata-core': patch
---

Clause-②: no

The `source` describe on `MetadataEventSchema` no longer lists `"fs"`, `"studio"`, `"rest"`, `"ai"` and
`"git-import"` as origin labels: of those, only `fs` is written by any producer (`FileSystemRepository`),
and no write path stamps an authoring surface there. It now says what the field is: the write path that
produced the event, an open label its writer stamps rather than an enum to pick from or match against, for
example `protocol.saveMetaItem`, `protocol.publishMetaItem`, `migrate-stored`, `sys-metadata-repo`
(`SysMetadataRepository`'s default) or `fs`. The field stays `z.string()`, so no key, type, export or
accepted value changes, and every repository emits exactly what it emitted before.
