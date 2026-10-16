---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(rest,runtime)!: a JSON `null` body on a `/data` create or query is refused `400 VALIDATION_FAILED` on both doors; the runtime dispatcher's `POST /data/:object/query` validates `FindDataRequestSchema`; and the dispatcher asks an object's API exposure before any request gate

`RestServer` read a JSON `null` body on `POST /data/:object` as an empty record and created an empty row, and on `POST /data/:object/query` as no query and answered the full record set. The runtime dispatcher's `/data` domain, the only answer on a host that mounts just the `@objectstack/hono` catch-all, did the same for the create, and validated no query at all: a mistyped clause or a retired key reached the engine, which dropped it and answered the full record set. `CreateDataRequestSchema.data` declares a record and `FindDataRequestSchema.query` declares a QueryAST or nothing, never `null`. Both doors now validate the assembled request as the caller sent it, forward that same request, and answer each case alike. On an object whose API exposure denies the verb, the dispatcher used to answer a `PATCH` body that is not a record, or a create body that is an array, a string or a number, with its request gate's `400`, where `RestServer` answered the exposure refusal; it now asks the exposure gate before each request gate, as `RestServer` does.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of two HTTP routes on two doors: a create or query whose body is a JSON `null`, and on the dispatcher a query the request schema does not declare, is now refused by the request schema where it was applied (or, for a string or array query body, refused by the engine under another code), and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you, wherever `@objectstack/rest` or the runtime dispatcher serves these routes:

- Both doors, `POST /data/:object` with a JSON `null` body: FROM `201` and an empty row created, TO `400 VALIDATION_FAILED` naming `data`, with no row created.
- Both doors, `POST /data/:object/query` with a JSON `null` body: FROM `200` with the full record set, TO `400 VALIDATION_FAILED` naming `query`, the engine never asked.
- The runtime dispatcher, `POST /data/:object/query` with a mistyped clause (`{ "limit": "ten" }`), the retired `joins` key, or a number as the body: FROM `200` with the full record set, the clause dropped, TO `400 VALIDATION_FAILED` naming the member (`query.limit`, `query.joins`, `query`). `RestServer` already answered this.
- The runtime dispatcher, `POST /data/:object/query` with a string or an array as the body: FROM the engine's `400 INVALID_FIELD` for numbered field names, TO `400 VALIDATION_FAILED` naming `query`. `RestServer` already answered this.
- The runtime dispatcher, `POST /data/:object/query` with a body that nests the query under a `query` key (`{ "query": { "where": … } }`): FROM read as the nested query (`200`), TO read as `RestServer` reads it, the body itself being the query, so `query` is a field the object does not have: `400 INVALID_FIELD`.
- The runtime dispatcher, `PATCH /data/:object/:id` with a body that is not a record (an array, a string, a number or `null`), and `POST /data/:object` with an array, a string or a number as the body, on an object whose API exposure denies the verb: FROM `400 VALIDATION_FAILED`, TO the exposure refusal `RestServer` answers (`404` when the object sets `apiEnabled: false`, `405` when its `apiMethods` leaves the verb out). The request was refused before and is refused now; only the answer changes. A JSON `null` create on such an object already answered the exposure refusal (the old gate read it as `{}`), and so did every query on it: the query route had no request gate, and its new one runs after the exposure gate, as `RestServer` orders it.

How it renders: `RestServer` answers `{ error, code: 'VALIDATION_FAILED', fields, object }`, the envelope its request gates already use. The runtime dispatcher returns its own `400 VALIDATION_FAILED` envelope, `fields` under `error.details`, instead of throwing, so a `@objectstack/hono` `createHonoApp` host renders it as `400`.

Unchanged: an empty request body, which every host hands over as `{}` (an empty record creates a row; an empty query answers every record); a record body; a conforming query; and a body `object` key on a query, which the path object still overrides.

To create a row, send its fields as a JSON object, `{}` for all defaults. To query, send the QueryAST itself as the body, `{}` for every record. The `@objectstack/client` SDK's `data.create` and `data.query` send exactly these, so an SDK caller is affected only when the value it passes is `null`, or not the shape the request declares.
