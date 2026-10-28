---
'@objectstack/spec': patch
---

fix(spec)!: `QueryTransportParamsSchema.select` / `$select` and `GetDataRequestSchema.select` declare the projection the `findData` and `getData` doors accept, instead of any string or list (#26909)

Clause-②: no (narrowing) — the published body-side declarations of the list door's projection (`select`, `$select`, reached through `QueryWithTransportSchema` and `FindDataRequestSchema.query`) and the by-id request's `select` refuse a value naming no field, which they admitted before. The doors already refused it with a 400; nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: these are transport request declarations, never stored, and the values they stop admitting are values the Data API doors already refused. A caller names at least one field or leaves the parameter out; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of published transport declarations (`@objectstack/spec/data`, `@objectstack/spec/api`), read by the `POST /data/:object/query` body gate, codegen, the reference docs and clients.

- **Before.** `select` / `$select` admitted any string or list: a blank, whitespace-only or comma-only string, `[]`, and a list with a blank name. `GetDataRequestSchema.select` admitted `[]` and blank names.
- **Now.** A string must name at least one field after the door's own split and trim (published as the pattern `[^\s,]`, the same rule `HttpFindQueryParamsSchema.select` states since #26817). A list must hold at least one name, and no name may be blank. `HttpFindQueryParamsSchema.select` and `GetDataRequestSchema.select` read these rules off `QueryTransportParamsSchema.select` rather than restating them.
- **`POST /data/:object/query`.** That route parses its body with `FindDataRequestSchema`, so an empty `select` / `$select` is now refused at the body schema: still `400`, still before any read, but `VALIDATION_FAILED` with `fields[0].field` naming `query.select` / `query.$select`, where it was `VALIDATION_ERROR` from the list door. A list with a blank name (`["name", ""]`) is likewise `400 VALIDATION_FAILED` at the schema, where it was `400 INVALID_FIELD` (an unknown field). This is how that route already answers a malformed `limit` or `count`.
- **Unchanged.** `GET /data/:object` and `GET /data/:object/:id` still answer an empty `select` with `400 VALIDATION_ERROR` naming it; a named projection (`name,email`, `["name", "email"]`, spaces and empty members between commas trimmed by the door) and an explicit `null` (a withdrawal) are accepted as before.
- **Who sees it.** A caller of `POST /data/:object/query` that branches on the `VALIDATION_ERROR` code for an empty projection, code that parses a query bag with these schemas and sent an empty projection, or a generated client that trusted the wider declaration.

**The remedy.** Send `select` naming at least one field, or leave it out to read every column.
