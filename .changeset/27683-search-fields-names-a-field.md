---
'@objectstack/spec': patch
---

fix(spec)!: `QueryTransportParamsSchema.$searchFields`, `QuerySchema.searchFields` and `FullTextSearchSchema.fields` declare the search-field override the Data API doors accept, instead of any string or list (#27683)

Clause-②: no (narrowing) — the published declarations of the search-field override (`$searchFields`, the canonical `searchFields`, and the structured `search.fields`, reached through `QueryWithTransportSchema` and `FindDataRequestSchema.query`) refuse a value naming no field, which they admitted before. The doors already refused it with a 400; nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: these are query declarations no metadata type embeds, never stored, and the values they stop admitting are values the Data API doors already refused. A caller names at least one field or leaves the key out; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of published query declarations (`@objectstack/spec/data`, and `@objectstack/spec/api` through `FindDataRequestSchema`), read by the `POST /data/:object/query` body gate, codegen, the reference docs and clients.

- **Before.** `$searchFields` admitted any string or list: a blank, whitespace-only or comma-only string, and `[]`. `QuerySchema.searchFields` and `FullTextSearchSchema.fields` admitted `[]`. The published JSON Schema admitted what the doors refuse.
- **Now.** A string must name at least one field after the door's own split and trim (published as the pattern `[^\s,]`), and a list must hold at least one name. That is exactly the set the door refuses as naming no field. A list with a blank member is still admitted by the schema, as the door admits it as a value and then refuses the blank name as an unknown field.
- **`POST /data/:object/query`.** That route parses its body with `FindDataRequestSchema`, so an empty `searchFields`, `$searchFields` or structured `search.fields` is now refused at the body schema: still `400`, still before any read, but `VALIDATION_FAILED` with `fields[0].field` naming `query.searchFields`, `query.$searchFields` or `query.search.fields`, where it was `VALIDATION_ERROR` from the list door. This is how that route already answers an empty `select`.
- **Unchanged.** `GET /data/:object` and `GET /data/:object/export` still answer an empty `$searchFields` / `searchFields` with `400 VALIDATION_ERROR` naming it; a named override (`label`, `["label", "note"]`, spaces and empty members between commas trimmed by the door) and an explicit `null` (a withdrawal) are accepted as before. The engine-side declarations (`EngineQueryOptionsSchema.searchFields` and its aggregate and count siblings) still admit `[]`, and the in-process engine still reads an empty override as absent; moving them is a separate change. The structured `search` form those engine declarations share is `FullTextSearchSchema`, so its `fields: []` is refused there too, though the engine itself does not parse `search`.
- **Who sees it.** A caller of `POST /data/:object/query` that branches on the `VALIDATION_ERROR` code for an empty search-field override, code that parses a query bag with these schemas and sent an empty override, or a generated client that trusted the wider declaration.

**Supersedes, in the same release.** The `#27484` entry's "Not yet narrowed" bullet no longer holds: the three declarations it names other than `EngineQueryOptionsSchema.searchFields` refuse `''` and `[]` now, and on `POST /data/:object/query` an empty `searchFields` is the body schema's `400 VALIDATION_FAILED`, the same answer `select: []` gets.

**The remedy.** Send the override naming at least one field, or leave it out to search the object's default search fields.
