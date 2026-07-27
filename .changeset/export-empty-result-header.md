---
"@objectstack/rest": patch
---

fix(rest): export emits the projected header row on an empty result set (#3547)

`GET /data/:object/export` wrote a zero-byte file whenever the query matched no
rows — the header was only ever written alongside the first data chunk. With the
`getReadableFields` column projection the readable column set is derived from
schema + context, so it is known even when no rows come back: an empty CSV/xlsx
export now carries the exact readable header, which also makes it a usable
import template.

The header is emitted only when the column set is AUTHORITATIVE — the security
service's readable projection, or an explicit `?fields=` request. When the header
is schema-derived and the projection was unavailable, the export stays headerless
as before: the masked-row fallback has no rows to narrow with, and writing the
full schema header would name FLS-hidden columns. `header=false` still suppresses
the header in every case.
