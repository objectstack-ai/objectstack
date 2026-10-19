---
'@objectstack/spec': patch
---

Clause-②: no

The `source` describe on `HistoryMetaItemResponseSchema`'s events, the body of
`GET /api/v1/meta/:type/:name/history`, no longer lists `"fs"`, `"studio"`, `"rest"`, `"ai"` and
`"git-import"` as its labels: none of the write paths in `@objectstack/metadata-protocol` whose history
rows this door reads stamps any of them. It now says what the field is: an open code-path label the
server stamps, not an enum an author or client picks from, for example `protocol.saveMetaItem`,
`protocol.publishMetaItem` or `migrate-stored`, with `sys-metadata-repo` as the repository's own default
and the answer for a row that stored none. The field stays `z.string()`, so no key, type, export or
accepted value changes, and the door answers exactly what it answered before.
