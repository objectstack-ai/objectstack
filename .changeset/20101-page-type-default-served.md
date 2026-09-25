---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a page saved without `type` is stored and served with the `type` default that `PageSchema` declares (#20101)

Clause-②: no

`PageSchema` declares `type: PageTypeSchema.default('record')`, so a page authored without `type` is a record page. `saveMetaItem` parsed the body with that default and then stored the body as authored, and the `/meta` reads serve stored rows without parsing them. A record page authored without `type` was therefore served with no `type` at all. A renderer that picks an object's record page by `type === 'record'` never picked it.

The declared default now reaches the served body at two points:

- **Save.** When the schema gate accepts a page that omits `type`, the stored body gets the declared default, on draft and publish saves alike. A page with an explicit `type` is stored unchanged. Because the stored row and the served document are the same bytes, a client that re-saves the page it just read writes nothing: the checksum and the version stay the same.
- **Read.** A page row stored before this change is served with the declared default. This covers the list and single `/meta/page` reads, the cached read, draft reads and the `?preview=draft` list, the layered read, boot hydration into the registry, and the `searchAll` page sweep, whose hit now carries `pageType: 'record'` for such a page. The row itself is not rewritten, and `os migrate meta --stored` reports it canonical.

The value is read from the registered `page` schema, never written out a second time. Only an absent `type` is filled: an explicit value, of any page type, is served as stored.

What moves for a client: the served body of such a page gains `type: 'record'`, a key `PageSchema` already declares. The set of accepted bodies is unchanged. The ETag of the cached single read for such a page changes once, because the served content changed. Saving that page again after reading it stores `type` once. From then on a read-then-save round-trip writes nothing.
