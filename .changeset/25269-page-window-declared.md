---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

fix(spec)!: the published list-query schemas declare the page window the Data API enforces — a non-negative integer — instead of any number

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no metadata type, authorable metadata key, object definition or stored shape is added, removed, renamed or re-shaped. What narrows is two request schemas a Data API caller is validated against (`FindDataRequestSchema`, through `QueryWithTransportSchema` and `QueryTransportParamsSchema`, and `HttpFindQueryParamsSchema`), and every value they now refuse was already refused by the list doors since the page-window normalizer landed. There is nothing for `objectstack migrate meta` to rewrite; the remedy is in the request (send a whole count, or leave the parameter out). -->

**BREAKING** accept-set narrowing on two published request schemas. It changes what a schema-validated Data API request may carry, not what a metadata author can write, so it ships as `patch` with this banner.

- **Before.** `FindDataRequestSchema` (the `POST /api/v1/data/:object/query` body) declared `limit` / `offset` / `top` as any number and `$top` / `$skip` / `skip` as any number or string, and `HttpFindQueryParamsSchema` (the `GET /api/v1/data/:object` querystring) declared `top` / `skip` as `z.coerce.number()`. A client generated from them, or a request validated against them, was told `-1`, `1.5` or a blank `?top=` was valid, and the door then refused it with a `400`.
- **Now.** Each of those parameters declares the page window the door enforces: a non-negative integer, or on the string-carrying spellings the digits a querystring carries it as (`'50'`). `-1`, `1.5`, `NaN`, `Infinity`, a blank or whitespace-only string, and a string that is not a count fail the parse. The bound is exported once, as `QueryPageWindowSchema` / `QueryPageWindowParamSchema` (`@objectstack/spec/data`), and the list-query normalizer in `@objectstack/metadata-protocol` now judges every window by that same schema, so the two accept sets are one declaration.
- **One answer moves, and only its code.** On `POST /api/v1/data/:object/query` (and the runtime dispatcher's `POST` twin) a malformed window is now refused by the body schema, like every other malformed body: `400 VALIDATION_FAILED` with `fields[0].field` naming `query.limit` / `query.offset`, where it was `400 INVALID_REQUEST` from the normalizer. Still a `400`, still before any read. `GET /api/v1/data/:object` has no body schema and answers `400 INVALID_REQUEST` naming the parameter as before.
- **Unchanged.** A well-formed window parses and pages exactly as before, `0` included (`$top=0` asks for the total alone). Windows inside `expand` and the engine and driver contracts (`QuerySchema`, `EngineQueryOptionsSchema`) are not narrowed: no door refuses those.

**The remedy.** Send the window as a whole count of zero or more, or leave the parameter out.
