---
'@objectstack/driver-odata': patch
---

feat(driver-odata): a new package, `@objectstack/driver-odata`, serves an OData v4 service's entity sets as external objects through a plugin driver, with no code per entity set

Clause-②: no
Metadata-protocol: none

A server plugin, `createODataDriverPlugin({ name, serviceRoot, auth, pageSize, requestTimeoutMs, secrets })`, publishes an `ODataDriver` as the kernel service `driver.NAME` (`driver.odata` by default). The datasource it serves is declared as any plugin-driver datasource is (its `name` and `driver` both the plugin's `name`, `schemaMode: 'external'`), and each object binds an entity set through `external.remoteName`, renaming properties through `external.columnMap`.

- **A plugin driver id, not a built-in one.** The id is not added to the spec's driver vocabulary, so the engine floors the driver: what the driver does not narrow, the engine applies in memory under its 1000-row cap. `supports` makes no pushdown claim.
- **Reads.** `find` sends `$filter`, `$orderby`, `$select`, `$top` and `$skip` and follows `@odata.nextLink` (same origin only). `$filter` carries comparisons, `$in`, `$between`, `$null`, `contains` / `startswith` / `endswith` / case-folded `contains`, under `and` / `or`; anything else (`$not`, `$like`, text ordering and negation, field references, collection properties) is left to the engine, so the service is only ever asked a wider question. A paged read is ordered by the entity key last. `count` sends `$count=true` when the whole `where` was translated and refuses otherwise.
- **Writes**, under the datasource's `external.allowWrites` and the object's `external.writable`: `POST`, `PATCH` and `DELETE` by key, with `If-Match` carrying the `@odata.etag` of the row's last read. Only properties the entity type declares are sent. A refused write reaches the caller as `422 EXTERNAL_WRITE_REFUSED` with the service's message; `upsert`, the bulk verbs and transactions are refused by name.
- **Keys and schema.** The key comes from `$metadata` (CSDL 4.0, inheritance and namespace aliases resolved); a row's `id` is the key's value, or the key predicate body for a composite key. `introspectSchema` lists entity sets, EDM-typed properties, keys and single-valued navigation properties as lookup candidates.
- **Credentials.** The secret is the datasource's `external.credentialsRef`, dereferenced through the host's datasource secret store (`options.secrets`, the same binder the datasource admin plugin takes) at the first request, and again once after a 401. `bearer` and `basic` are supported; a missing reference, store or secret refuses the request rather than sending it unauthenticated. The config itself refuses a `serviceRoot` that carries credentials.
- **The dialect seam.** Headers, the response envelope, the `$metadata` reader, literal and function spellings and the count option go through one `ODataDialect`; only `odataV4Dialect` ships. A v2 dialect is a new file implementing it.
