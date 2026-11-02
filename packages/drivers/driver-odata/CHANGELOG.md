# @objectstack/driver-odata

## 18.3.0

### Minor Changes

- d359857: feat(driver-odata): an OData v2 service is served by the same driver with `version: '2.0'` — the verbose JSON envelope, `$inlinecount`, typed literals, `MERGE`, and `$metadata` Associations read into the lookups an import drafts
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  `createODataDriverPlugin({ …, version: '2.0' })` (and `parseODataDriverConfig`) now accepts `'2.0'` beside `'4.0'`, which stays the default. Before, any value but `'4.0'` refused the boot. The v2 dialect (`odataV2Dialect`, `parseCsdlV2`, exported beside the v4 ones) plugs into the existing dialect seam; the driver and the `$filter` translator are unchanged, so the never-narrower rule, paging, keys, ETags and the error mapping hold as on v4. Only the public v2 protocol ships: SAP Gateway's CSRF token handshake, `sap-client` and the `sap:*` annotations stay out of this repository, for a vendor plugin.
  
  - **Requests and the envelope.** Requests carry `DataServiceVersion: 2.0` and ask for `application/json`. A collection is read out of `d.results` (or a 1.0 service's bare `d` array), with `__next` followed as `@odata.nextLink` is and the string `__count` read as the count. An entity is read out of `d`; its ETag comes from `__metadata.etag`; `__metadata` and each navigation's `{ __deferred }` stub are dropped from the row.
  - **Count.** `count` sends `$inlinecount=allpages&$top=0`.
  - **`$filter`.** `$contains` is `substringof('x',P)`; `startswith` / `endswith` / `tolower` as on v4. Literals are typed: `datetime'…'`, `datetimeoffset'…'`, `time'PT…'`, `guid'…'`, `7L`, `1.5M` (no exponent), `1.5d`, `1.5f`. An `Edm.DateTime` comparand is pushed down only when it names its instant (a zone, an offset or a `Date`), as that instant's UTC wall clock; a bare date or a zone-less date-time is left to the engine.
  - **Keys.** Key predicates take the same typed literals (`Shipments(guid'…')`, `Items(7L)`), and a composite key's `id` (`TrackingId=guid'…',Leg=2L`) is read back into the same predicate.
  - **Values.** `Edm.DateTime` (`/Date(ms)/`) is read as the UTC instant, or as its date under a field the object declares `date` (v2 has no `Edm.Date`); `Edm.Int64` and `Edm.Decimal` text is read as a number (an `Edm.Int64` beyond the safe range stays text); `Edm.Time` (`PT13H20M`) is read as the time of day. Writes go out in the same forms.
  - **Writes.** `create` is `POST`; a partial update is `MERGE`, sent as a `POST` tunnelled with `X-HTTP-Method: MERGE`; `delete` is `DELETE`. `If-Match` carries the `__metadata.etag` of the row's last read.
  - **`$metadata`.** EDMX 1.0 is read: a navigation's target and cardinality come from its `Association` ends, its foreign key from the Association's `ReferentialConstraint` when this type is the dependent end, and its target entity set from the `AssociationSet`s. `introspectSchema()` reports dialect `odata-2.0` and the same navigation shape v4 yields, so `generateObjectDraft` / `importObject` draft the same lookups over either version. A v2 document under `version: '4.0'`, or a v4 one under `'2.0'`, is refused with the version that reads it named.
  - **The dialect seam** gains four optional members (`readValue`, `writeValue`, `keyValue`, `updateRequest`); a dialect that leaves one out keeps the v4 behaviour, so an out-of-repo dialect still compiles. `readValue` is given the declared type of the field a property backs, which the driver now records from the object's `fields` in `registerExternalObject`.
  - **`@objectstack/spec`:** the type matrix's `odata` arm reads the two primitives only v2's CSDL declares, `Edm.DateTime` → `datetime` and `Edm.Time` → `time`. Both were `unknown`: a draft typed them `text` and flagged them for review, and a `datetime` or `time` field declared over one failed Gate 2 as a `type_mismatch`. Nothing that passed before fails now.

### Patch Changes

- 0a4b0fb: feat(driver-odata): a new package, `@objectstack/driver-odata`, serves an OData v4 service's entity sets as external objects through a plugin driver, with no code per entity set
  
  Clause-②: no
  Metadata-protocol: none
  
  A server plugin, `createODataDriverPlugin({ name, serviceRoot, auth, pageSize, requestTimeoutMs, secrets })`, publishes an `ODataDriver` as the kernel service `driver.NAME` (`driver.odata` by default). The datasource it serves is declared as any plugin-driver datasource is (its `name` and `driver` both the plugin's `name`, `schemaMode: 'external'`), and each object binds an entity set through `external.remoteName`, renaming properties through `external.columnMap`.
  
  - **A plugin driver id, not a built-in one.** The id is not added to the spec's driver vocabulary, so the engine floors the driver: what the driver does not narrow, the engine applies in memory under its 1000-row cap. `supports` makes no pushdown claim.
  - **Reads.** `find` sends `$filter`, `$orderby`, `$select`, `$top` and `$skip` and follows `@odata.nextLink` (same origin only). `$filter` carries comparisons, `$in`, `$between`, `$null`, `contains` / `startswith` / `endswith` / case-folded `contains`, under `and` / `or`; anything else (`$not`, `$like`, text ordering and negation, field references, collection properties) is left to the engine, so the service is only ever asked a wider question. A paged read is ordered by the entity key last. `count` sends `$count=true` when the whole `where` was translated and refuses otherwise.
  - **Writes**, under the datasource's `external.allowWrites` and the object's `external.writable`: `POST`, `PATCH` and `DELETE` by key, with `If-Match` carrying the `@odata.etag` of the row's last read. Only properties the entity type declares are sent. A refused write reaches the caller as `422 EXTERNAL_WRITE_REFUSED` with the service's message; `upsert`, the bulk verbs and transactions are refused by name.
  - **Keys and schema.** The key comes from `$metadata` (CSDL 4.0, inheritance and namespace aliases resolved); a row's `id` is the key's value, or the key predicate body for a composite key. `introspectSchema` lists entity sets, EDM-typed properties, keys and single-valued navigation properties as lookup candidates.
  - **Credentials.** The secret is the datasource's `external.credentialsRef`, dereferenced through the host's datasource secret store (`options.secrets`, the same binder the datasource admin plugin takes) at the first request, and again once after a 401. `bearer` and `basic` are supported; a missing reference, store or secret refuses the request rather than sending it unauthenticated. The config itself refuses a `serviceRoot` that carries credentials.
  - **Read scopes.** A `ReadableIds` leaf (a read-scope semi-join) is refused by the driver itself, in the shared refusal envelope, before anything is sent: `$filter` cannot spell it, and leaving it out would read it as no restriction.
  - **Conformance.** The package runs all eleven shared driver case-sets, behind the real engine floor, over an in-process OData service that evaluates the `$filter` the driver writes, under an ordinal and a case-insensitive collation.
  - **`@objectstack/spec`:** `llms.txt` counts the new package (73 published).
  - **The dialect seam.** Headers, the response envelope, the `$metadata` reader, literal and function spellings and the count option go through one `ODataDialect`; only `odataV4Dialect` ships. A v2 dialect is a new file implementing it.
- d3b0a40: feat(datasource): import objects from an OData datasource's `$metadata` — EDM types map to field types, the key to the id, and navigations to lookups; Studio's datasource page imports several entity sets at once, and MCP gains `list_remote_tables` / `import_object`
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  - **Type matrix (`@objectstack/spec/data`).** `SqlDialect` gains `'odata'`, whose aliases map the EDM primitives (`Edm.String`, `Edm.Int16/32/64`, `Edm.Decimal`, `Edm.Double`, `Edm.Boolean`, `Edm.Date`, `Edm.DateTimeOffset`, `Edm.TimeOfDay`, `Edm.Guid`, `Edm.Binary`, `Edm.Stream`, `Collection(…)`) onto the matrix's canonical types. `Edm.Duration`, the geography / geometry families and a service's own enum or complex types stay unknown, so a draft flags them for review. `Edm.Int64` and `Edm.Decimal` take the same verdict as SQL `bigint` / `numeric` (exact for `number`).
  - **Gate 2 gets looser, for SQL federation too.** `lookup` and `master_detail` are now exact under the `text`, `integer` and `bigint` rows, as they already were under `uuid`: a reference stores the target's id, which on a federated object is the remote key a foreign-key column carries. Before, `isCompatible` refused a lookup over `CustomerID int` or `varchar` as a `type_mismatch` error, so the boot validation (`onMismatch: 'fail'`) refused any federated object that declared one. Nothing that passed before fails now.
  - **Draft (`@objectstack/service-datasource`).** For an OData datasource (the driver reports dialect `odata-4.0`, read as the `odata` vocabulary) `generateObjectDraft` / `importObject` / `refreshCatalog` and the validation map EDM types through that arm. A column whose name is not a snake_case field name drafts as its snake_case spelling with `external.columnMap` carrying the remote name (`CategoryID` → `category_id`); `rename` overrides now land in `columnMap` too, so a renamed field stays bound to its column. A remote table name drafts the same way (`Products` → `products`; a leading capital used to give `_products`). A single-valued navigation becomes a `lookup` on the column its `ReferentialConstraint` names when the constraint references the target's single key and the target is imported on the same datasource (or is the object itself); every other navigation is left out of the draft and named in `review` with its reason — import the target first.
  - **Driver (`@objectstack/driver-odata`).** `introspectSchema()` lists each navigation's `referentialConstraints`.
  - **Studio.** The datasource page's tables tab selects several entity sets and imports them in one go, saving lookup targets before the tables that reference them; the write opt-in is offered only on a datasource that allows writes, and an imported object stays read-only otherwise (single-table dialog included).
  - **MCP.** `list_remote_tables` and `import_object` reach the same `IExternalDatasourceService` calls, registered only for a token whose scopes name `metadata:write`, and refused by the runtime bridge without the capability the REST twins require (`FEDERATION_READ_CAPABILITY` / `FEDERATION_WRITE_CAPABILITY`, now exported from `@objectstack/rest`).
- ed8b237: feat: a datasource that names a connector instance in `external.connector` borrows that instance's credential at runtime, and its driver presents it per request
  
  Clause-②: yes
  Metadata-protocol: none
  
  The runtime half of ADR-0015 amendment D7. A datasource over a vendor API that names a declared connector instance now reads with that instance's credential — the one set under Setup → Connector credentials (or the instance's environment variable, or the host's resolver) — so one credential serves the connector's flow actions and the datasource's virtual objects:
  
  ```ts
  connectors: [{ name: 'sap_s4', type: 'api', provider: 'openapi', providerConfig: { spec: './sap-openapi.json' },
    auth: { type: 'bearer', credentialRef: 'sap_token' } }],
  datasources: [{ name: 'sap_orders', driver: 'sap_orders', config: {},
    schemaMode: 'external', external: { connector: 'sap_s4' } }],
  // served by createODataDriverPlugin({ name: 'sap_orders', serviceRoot: '…' }), its auth left at 'none'
  ```
  
  - **`@objectstack/service-automation`** registers a `connector-credential-source` service that lends a declared instance's credential (bearer, API key, basic), resolved through the same chain the connector itself uses. A credential set or changed through the credential door is picked up by the datasource's next request, with no restart.
  - **`@objectstack/service-datasource`** borrows it when such a datasource connects (a plugin driver the engine already adopted from its `driver.<name>` service is judged at that connect too), is probed (Test connection) or is saved from the admin door, and hands the driver factory a credential handle on `DatasourceConnectionSpec.credential`. A datasource whose instance is not declared, is a catalog descriptor, has no `auth` credential or is disabled — or a stack with no automation service to lend it — is refused, fail-closed, with a reason naming the fix: it never connects to fail its first read with an upstream 401.
  - **`@objectstack/driver-odata`** presents it: a datasource it serves that names `external.connector` borrows the handle at its first request and sends every request through `callWithBorrowedCredential`, in the form the instance's `auth` declares (bearer, basic, or an API key as a header or query parameter). An upstream's error text is stripped of every spelling of the presented credential before it is thrown (`withoutBorrowedCredential`), so an API key sent as a query parameter never reaches an error body through a service that echoes the request URI. `external.credentialsRef` keeps its path; both channels at once, or an `auth.scheme` set on the plugin beside the connector, refuse the request.
  - **`@objectstack/types`** carries the contract (`IConnectorCredentialSource`, `ConnectorCredentialHandle`, `CONNECTOR_CREDENTIAL_SOURCE_SERVICE`) and `callWithBorrowedCredential`, the one rule a plugin driver presents a borrowed credential by: refreshed when it has expired, refreshed once and retried on a `401`, and a `503 SERVICE_UNAVAILABLE` naming the instance when the fresh one is refused too.
  
  Nothing changes for a datasource that binds its own secret with `external.credentialsRef`. The handle answers the grant-bearing kinds (OAuth2 and the app-credential exchange) through the same interface when connector instances can declare them; a driver written against it today needs no change then.
- 6e53003: docs(driver-odata): the README links the OData datasources guide
  
  Clause-②: no
  Metadata-protocol: none
  
  The package README now points to the OData datasources guide (`/docs/data-modeling/odata-datasources`), which covers checking a service, mounting the plugin, binding objects to entity sets, credentials through `external.credentialsRef`, what the service is asked behind the engine's floor, writes, and how failures reach the caller. No code changes.
- 0a52b7d: feat: `os serve` publishes its datasource secret store's `resolve` as the kernel service `datasource-secret-resolver`, and `driver-odata` reads it when it is passed no secret store
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  A stack served by `os serve` that mounts `createODataDriverPlugin` could not resolve its datasource's `external.credentialsRef`: the server's `sys_secret` store was handed only to the datasource admin, so a `sys_secret:` handle stored through Setup → Datasources did not resolve for the plugin, and the stack had to pass a `resolve` of its own. It now resolves with no code:
  
  ```ts
  plugins: [createODataDriverPlugin({ name: 'erp', serviceRoot: 'https://erp.example.com/odata/', auth: { scheme: 'bearer' } })],
  datasources: [{ name: 'erp', driver: 'erp', config: {}, schemaMode: 'external',
    external: { credentialsRef: 'sys_secret:…' } }],
  // no `secrets` option: under os serve the handle resolves through the server's own store
  ```
  
  - **`@objectstack/cli`**: `os serve` registers the read half of the datasource secret binder it builds as the kernel service `datasource-secret-resolver` (plugin `com.objectstack.cli.datasource-secret-resolver`). Only `resolve` is published; storing and removing a credential stays the datasource admin's. It decrypts datasource credentials only: a settings secret or a secret field's row in `sys_secret` does not open through it. When `os serve` builds no binder (no crypto provider), the service is not registered.
  - **`@objectstack/driver-odata`**: when `options.secrets` is absent, the plugin reads the `datasource-secret-resolver` service at the first request. An explicit `options.secrets` still wins. With neither, the request is refused as before, sent to nobody, and the message now names the service.
  - **`@objectstack/types`**: `DATASOURCE_SECRET_RESOLVER_SERVICE` and `IDatasourceSecretResolver`, the contract a host publishes the resolver under and every plugin driver that dereferences a `credentialsRef` reads it by: an explicit store first, the service looked up at the first request (never at `init`), fail-closed when neither resolves.
- Updated dependencies [2f21b48]
- Updated dependencies [0ea90c7]
- Updated dependencies [dbf7e04]
- Updated dependencies [a9f654e]
- Updated dependencies [b49b752]
- Updated dependencies [d8a9cc5]
- Updated dependencies [b53d9f3]
- Updated dependencies [8eeb3b3]
- Updated dependencies [4f05de4]
- Updated dependencies [95f818d]
- Updated dependencies [b3f7344]
- Updated dependencies [d90657b]
- Updated dependencies [ff26bc4]
- Updated dependencies [21a13f1]
- Updated dependencies [c68869c]
- Updated dependencies [162f668]
- Updated dependencies [43714ca]
- Updated dependencies [63e3873]
- Updated dependencies [9bf6598]
- Updated dependencies [a98693d]
- Updated dependencies [d9bf777]
- Updated dependencies [bb91ae8]
- Updated dependencies [d434481]
- Updated dependencies [f9f27a0]
- Updated dependencies [02b1392]
- Updated dependencies [c26d643]
- Updated dependencies [13e85be]
- Updated dependencies [13dc413]
- Updated dependencies [eab4bba]
- Updated dependencies [e438a55]
- Updated dependencies [2205863]
- Updated dependencies [9fab076]
- Updated dependencies [74801d1]
- Updated dependencies [17b5152]
- Updated dependencies [ef7067f]
- Updated dependencies [031d97a]
- Updated dependencies [0c47e87]
- Updated dependencies [e01edb2]
- Updated dependencies [f79fa74]
- Updated dependencies [b358e79]
- Updated dependencies [5374967]
- Updated dependencies [8a218fc]
- Updated dependencies [1539aad]
- Updated dependencies [cdd9f0a]
- Updated dependencies [3fe9d25]
- Updated dependencies [2ecf6a7]
- Updated dependencies [fbe344b]
- Updated dependencies [354dfcd]
- Updated dependencies [d887aa9]
- Updated dependencies [39fd5fb]
- Updated dependencies [5aad4e0]
- Updated dependencies [81b4599]
- Updated dependencies [c13ef04]
- Updated dependencies [6eaf404]
- Updated dependencies [79ed6f7]
- Updated dependencies [40320f1]
- Updated dependencies [49d652e]
- Updated dependencies [685d9f3]
- Updated dependencies [0fb0dda]
- Updated dependencies [e3470ed]
- Updated dependencies [9ac5ae5]
- Updated dependencies [c082af6]
- Updated dependencies [6dbff8e]
- Updated dependencies [c63ce2a]
- Updated dependencies [12b5aec]
- Updated dependencies [8b1740a]
- Updated dependencies [b88519e]
- Updated dependencies [e5b5c5b]
- Updated dependencies [d4ff1a0]
- Updated dependencies [10f27b6]
- Updated dependencies [fe9e856]
- Updated dependencies [d4ff1a0]
- Updated dependencies [ae16687]
- Updated dependencies [efdf11a]
- Updated dependencies [2655ebd]
- Updated dependencies [14e9685]
- Updated dependencies [0cd578f]
- Updated dependencies [a33fce2]
- Updated dependencies [385aa12]
- Updated dependencies [8bb2c31]
- Updated dependencies [8d79bbd]
- Updated dependencies [b8f4acc]
- Updated dependencies [4145210]
- Updated dependencies [194e66c]
- Updated dependencies [57c51aa]
- Updated dependencies [3604371]
- Updated dependencies [1ed3360]
- Updated dependencies [73b7270]
- Updated dependencies [6762dd9]
- Updated dependencies [556f323]
- Updated dependencies [b445807]
- Updated dependencies [6abcb72]
- Updated dependencies [7735d1d]
- Updated dependencies [7739573]
- Updated dependencies [bc4c963]
- Updated dependencies [86edcaf]
- Updated dependencies [ad3a640]
- Updated dependencies [fbaacfe]
- Updated dependencies [dbf576b]
- Updated dependencies [4fa4f2c]
- Updated dependencies [76b4ae4]
- Updated dependencies [0368504]
- Updated dependencies [6663a66]
- Updated dependencies [fbb8bec]
- Updated dependencies [f557d90]
- Updated dependencies [aad9ad5]
- Updated dependencies [e0aed00]
- Updated dependencies [72b08ee]
- Updated dependencies [bf658d1]
- Updated dependencies [3702be4]
- Updated dependencies [4a5396b]
- Updated dependencies [9d29223]
- Updated dependencies [7538f27]
- Updated dependencies [21c4bdd]
- Updated dependencies [2c683cf]
- Updated dependencies [86c9d53]
- Updated dependencies [bfdaba4]
- Updated dependencies [8441a01]
- Updated dependencies [db44327]
- Updated dependencies [0027c4a]
- Updated dependencies [684f2f6]
- Updated dependencies [869fa76]
- Updated dependencies [2fc3861]
- Updated dependencies [74aae1e]
- Updated dependencies [2b4b970]
- Updated dependencies [e063a87]
- Updated dependencies [03cc871]
- Updated dependencies [7811c3f]
- Updated dependencies [755e285]
- Updated dependencies [07585bf]
- Updated dependencies [9cbe507]
- Updated dependencies [2695de7]
- Updated dependencies [0a4b0fb]
- Updated dependencies [b373263]
- Updated dependencies [d3b0a40]
- Updated dependencies [ed8b237]
- Updated dependencies [a68430a]
- Updated dependencies [6da8c3c]
- Updated dependencies [1ea3fe9]
- Updated dependencies [3e0fd7a]
- Updated dependencies [f552fa8]
- Updated dependencies [dc4755c]
- Updated dependencies [0a52b7d]
- Updated dependencies [4793aa4]
- Updated dependencies [3a054cb]
- Updated dependencies [f934a41]
- Updated dependencies [00c9a0b]
- Updated dependencies [a7bdac4]
- Updated dependencies [c3842ac]
- Updated dependencies [916531a]
- Updated dependencies [d85ff19]
- Updated dependencies [7e3822c]
- Updated dependencies [645534d]
- Updated dependencies [3cc45cc]
- Updated dependencies [3a2f4c0]
- Updated dependencies [5b7dbb8]
- Updated dependencies [8d36669]
- Updated dependencies [e26cf9a]
- Updated dependencies [6e0b16a]
- Updated dependencies [7c3cc88]
- Updated dependencies [9b1dc99]
- Updated dependencies [f3fe660]
- Updated dependencies [3739d8d]
- Updated dependencies [f4a8eed]
- Updated dependencies [8f36f6b]
- Updated dependencies [80a9f99]
- Updated dependencies [11a7f96]
- Updated dependencies [b357250]
- Updated dependencies [75c2658]
- Updated dependencies [35f2055]
- Updated dependencies [fb4e0bb]
- Updated dependencies [7d846b5]
- Updated dependencies [fc5d509]
- Updated dependencies [71de060]
- Updated dependencies [6fd87b7]
- Updated dependencies [d359857]
- Updated dependencies [3238750]
- Updated dependencies [f23e051]
- Updated dependencies [bed8306]
- Updated dependencies [04c8930]
- Updated dependencies [001c04b]
- Updated dependencies [2d3aa8c]
- Updated dependencies [85a1b9d]
- Updated dependencies [361ea24]
- Updated dependencies [ea1751b]
- Updated dependencies [3fd4d6b]
- Updated dependencies [a00f335]
- Updated dependencies [700ec85]
- Updated dependencies [8bceb6a]
- Updated dependencies [8771726]
- Updated dependencies [ef0f6a1]
- Updated dependencies [9eaa209]
- Updated dependencies [ba0084e]
- Updated dependencies [462935d]
- Updated dependencies [0ecc2c4]
- Updated dependencies [d6e0967]
- Updated dependencies [519089e]
- Updated dependencies [16e7a80]
- Updated dependencies [044d201]
- Updated dependencies [12333ba]
- Updated dependencies [4d278c9]
- Updated dependencies [5114b0e]
- Updated dependencies [e62dcc5]
- Updated dependencies [0c1829a]
- Updated dependencies [36fa4ff]
- Updated dependencies [e170d42]
- Updated dependencies [f5a400a]
- Updated dependencies [1617b7f]
- Updated dependencies [a9782b3]
- Updated dependencies [60d8522]
- Updated dependencies [8196881]
- Updated dependencies [5493b88]
- Updated dependencies [663b7c0]
- Updated dependencies [50df124]
- Updated dependencies [3cb8553]
- Updated dependencies [70943dd]
- Updated dependencies [2081a5e]
- Updated dependencies [892eb66]
- Updated dependencies [2cba2eb]
- Updated dependencies [99a6a78]
- Updated dependencies [04b1402]
- Updated dependencies [672bda0]
- Updated dependencies [3e54f99]
- Updated dependencies [710c2da]
- Updated dependencies [5d759b1]
  - @objectstack/core@18.3.0
  - @objectstack/spec@18.3.0
  - @objectstack/types@18.3.0
