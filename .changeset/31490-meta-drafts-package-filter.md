---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
'@object-ui/data-objectstack': patch
---

fix(rest)!: `GET /api/v1/meta/_drafts` scopes by `?package=`, like every other metadata read, and refuses a query parameter it does not read

Clause-②: yes (narrowing) — `GET /api/v1/meta/_drafts` (on the REST server and the runtime dispatcher) declares its closed query-parameter set, `package` and `type`, and refuses any other name, the retired `packageId` among them, with `400 VALIDATION_ERROR`, where it ignored it and answered the drafts of every package with `200`. The widening half: `@objectstack/rest` exports two new names, the door's query decision that both transports ask: `META_DRAFTS_QUERY_PARAMS` and `metaDraftsQueryRefusal`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the protocol's ListDraftsRequest keeps its packageId field, and the SDK options keep their names. What moves is the drafts route's query-string spelling, and nothing at rest records it, so there is nothing for a migration to rewrite. -->

**The package filter.** `GET /api/v1/meta/_drafts?package=ID` lists only that package's pending drafts. It reads the value the way `GET /meta/:type` and `GET /meta/diagnostics` read it: `?package=all` lists every package, and a package that is neither installed nor bound to a pending draft is refused with `400 INVALID_REQUEST`. Before, the door read only `?packageId=`, so `?package=ID` was dropped and every package's drafts came back with `200`.

**BREAKING** accept-set narrowing at the drafts list (`@objectstack/rest`, `@objectstack/runtime`): a query parameter the door does not read is refused instead of ignored, and `?packageId=` is retired.

- **Before.** `GET /meta/_drafts?packageId=ID` narrowed to one package. `?package=ID`, `?typ=view` or any other name was ignored, and the drafts of every package (or every type) came back with `200`.
- **Now.** Only `package` and `type` are read. Any other name, `packageId` included, is refused with `400` and the nested `{ "error": { "code": "VALIDATION_ERROR", "message" } }` body, whose message names the parameter and lists the supported ones; nothing is read. A bracketed `?package[]=` or `?type[]=` keeps its own located refusal.
- **Who moves.** `@objectstack/client`'s `meta.listDrafts({ packageId })` and `@object-ui/data-objectstack`'s `MetadataClient.listDrafts({ packageId })` keep their option name and now send `?package=`, as does the Console. A script that sends `?packageId=` gets the 400.

**The remedy.** FROM `GET /api/v1/meta/_drafts?packageId=ID` TO `GET /api/v1/meta/_drafts?package=ID`. Upgrade `@objectstack/client` and `@object-ui/data-objectstack` together with the server.
