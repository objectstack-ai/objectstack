---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
'@objectstack/client': patch
'@objectstack/spec': patch
---

feat(rest)!: the metadata list reads several items by name in one request (`?names=a,b,c`), and refuses a query parameter it does not read

Clause-②: yes (narrowing + widening) — `GET /api/v1/meta/:type` (and its environment-scoped twin, on both the REST server and the runtime dispatcher) declares its closed query-parameter set, `package`, `preview`, `object`, `include`, `id`, `names` and `locale`, and refuses any other name with `400 VALIDATION_ERROR`, where it ignored it and answered the whole list with `200`. The widening half: `?names=a,b,c` narrows every type's list to the items of those names, `@objectstack/client`'s `meta.getItems(type, { names })` sends it, and `@objectstack/rest` exports three new names, the list's query decision that both transports ask: `META_LIST_QUERY_PARAMS`, `metaListQueryRefusal` and `metaListNames`. Ruling 6580261740 assigns both halves to this one server change.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `GetMetaItemsRequestSchema.names` was already declared, and only its description loses the planned marker. What moves is the list route's answer to a query-string name it never read, and nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**The batch by-names read.** `GET /api/v1/meta/:type?names=a,b,c` answers only the items of those names, among the items the list would answer without it, on every metadata type. One comma-separated value, as the data routes spell `fields`; each name is trimmed and repeats count once. A name that matches no item is simply absent from the answer (no `404`). The names are handed to the store read (`GetMetaItemsRequest.names`), so `@objectstack/metadata-protocol`'s `getMetaItems` filters before it computes locks, governance and diagnostics, and the list's per-caller gate, object field mask and translation run on the named items only. A value that names no item (`?names=`, `?names=,`) is refused with `400 VALIDATION_ERROR` rather than read as every item; leave the key out to list every item. A repeated `?names=` is refused like the list's other single-valued parameters. Before, `?names=` was ignored, so a client that needed several objects paid one by-name request for each.

**BREAKING** accept-set narrowing at the metadata list (`@objectstack/rest`, `@objectstack/runtime`): a query parameter the list does not read is refused instead of ignored.

- **Before.** `GET /meta/object?name=account`, `?ids=a,b` or `?filter=x` answered `200` with every object, which reads the same as a filter that matched everything.
- **Now.** A name outside `package`, `preview`, `object`, `include`, `id`, `names`, `locale` is refused with `400` and the nested `{ "error": { "code": "VALIDATION_ERROR", "message" } }` body; the message names the parameter and lists the supported ones, and nothing is read. A bracketed `?package[]=`, and `?id[]=` on the app list or `?object[]=` on the view list, keep their own located refusal; any other bracketed key (`?names[]=`) is refused as a name the list does not read.
- **Who moves.** The Console and the client SDK send only declared names. A script that sends another name gets the 400.

**The remedy.** Drop the parameter, or spell it as one of the supported names: `?names=a,b` for several items by name, `?id=APP` for one app, `?object=OBJECT` for one object's views, `?package=ID` for one package.
