# @objectstack/plugin-hono-server

## 17.1.0

### Minor Changes

- 152bff8: fix(hono-server): `http_requests_total` is emitted by the transport, so every inbound mount is counted (#9650)
  
  The counter had exactly one emitter: a `Proxy` the runtime dispatcher built
  over its **own** `IHttpServer` handle. It therefore saw only the routes the
  dispatcher itself registered — and nothing else on the same server.
  
  Measured, that left at least **14** inbound surfaces uncounted, in two
  structurally different classes:
  
  - plugins that mount through `getRawApp()` — auth (`/api/v1/auth/*`),
    metadata HMR, cloud-connection, marketplace, runtime-config, trigger-api,
    webhooks, approvals, the console SPA. These bypass `IHttpServer` entirely,
    so **no** wrapper at that level can ever reach them.
  - plugins that resolve `http.server` themselves and mount through the verb
    methods — the REST data API via `RouteManager`, storage, i18n, settings,
    datasource admin.
  
  The two highest-traffic surfaces an operator actually cares about, auth and
  the REST data API, were both in that set. The documented guidance is to alert
  on the 5xx rate derived from this counter, so a deployment could be melting
  down on `/api/v1/*` with the counter flat.
  
  The counter is now emitted from the Hono adapter itself, as a raw-app
  middleware installed at the end of `HonoServerPlugin.init()` beside
  `installMiddlewareSeam()` — the one layer every inbound request converges on,
  whatever registered the handler.
  
  **The route label is the matched PATTERN, never the concrete path.**
  `/api/v1/data/:id`, not one series per record id; `/api/v1/auth/*`, not one
  per sign-in endpoint. Cardinality has to stay bounded or the counter is
  unusable for the alerting it exists for, and the label is unfixable in place
  once dashboards are wired against the first shipped one.
  
  **Wiring.** `HonoServerPlugin` takes a new `observability.metrics` option and
  otherwise follows the canonical chain `ObservabilityServicePlugin` documents:
  explicit option, then the `observability:metrics` service, then **nothing** —
  with no backend configured no middleware is installed at all, so an
  unconfigured deployment pays no per-request cost.
  
  **Two consequences, stated rather than left to be discovered:**
  
  - **A transport that does not implement this seam reports no HTTP metrics.**
    The seam is Hono's. Another `IHttpServer` implementation emits nothing until
    it grows its own, and a zero there means "not instrumented", never "no
    traffic". A response-observing hook on the `IHttpServer` contract is the
    transport-agnostic successor and is filed separately.
  - **A request the `use()` chain refuses is still counted** — the seam is
    installed before the middleware seam, so the inbound rate limiter's `429`
    appears with `status="429"`. A preflight `OPTIONS` that the transport's own
    CORS built-in answers is **not** counted: it short-circuits earlier and
    never reaches a route.
- 88e1bac: fix(api): the plugin-mounted Hono error paths answer the declared envelope — six refusal bodies stop speaking the pre-#3675 dialect (#9364)
  
  Six hand-built refusal bodies on plugin-mounted Hono routes departed from
  `BaseResponseSchema`. They were invisible to every check in the repo until
  #9267 added the gate's third surface, which discovers these routes by parsing
  rather than by filename. This converts the **error-path** half of what that
  first run measured; the bare pre-auth discovery payloads it also found are a
  separate wire ruling (#9389) and are untouched here.
  
  **If you branch on these bodies, this is the change.** Every one of them was
  readable only by reaching for a key the contract does not declare, so no
  consumer that followed `ApiErrorSchema` was reading them successfully in the
  first place — `body.error.message` read `undefined` on all six.
  
  `@objectstack/plugin-hono-server` — the adapter's own refusals, the answer any
  host using it as its transport gets for an unmatched request or a handler that
  produced nothing:
  
  | status | was | now |
  |:--|:--|:--|
  | 404 unmatched path | `{ error: 'Not found' }` | `{ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } }` |
  | 405 method mismatch | `{ error, code, message, method, path, allowed }` | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED', message, details: { method, path, allowed } } }` |
  | 500 handler wrote nothing | `{ error: 'No response from handler' }` | `{ success: false, error: { code: 'INTERNAL_ERROR', message: 'No response from handler' } }` |
  | 500 fallback threw | `{ error: 'Fallback handler failed' }` | `{ success: false, error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' } }` |
  
  The 405 is the sharpest of the four: it already carried a real semantic code,
  but placed it BESIDE `error` rather than inside it, so `body.error.code` read
  `undefined` while `body.code` worked — the #7035 dialect. Its `code` **value**
  is unchanged (`METHOD_NOT_ALLOWED`, a `StandardErrorCode` member); only its
  position moved, along with the three context keys, which are now
  `error.details` — the slot `ApiErrorSchema` declares for exactly that. The
  `Allow` header is unchanged and remains the primary channel for it.
  
  `@objectstack/hono` — the shared `errorJson` helper wrote the HTTP **status**
  into `error.code`, so every refusal from this mount shipped `error.code: 404`
  or `500` where `ApiErrorSchema.code` declares a closed STRING vocabulary
  (ADR-0112 D3/D4). It now derives the standard member for the status through
  `resolveThrownHttpError` (`@objectstack/types`) — the one rule the REST and
  dispatcher doors already read for this question, so this third door does not
  become a fourth dialect. A 404 from this mount now carries
  `error.code: 'RESOURCE_NOT_FOUND'`; the numeric status stays where it is
  authoritative, on the response line.
  
  `@objectstack/cli` — the unbound-hostname 404 from `os serve`'s
  `OS_ROOT_DOMAIN` guard answered
  `{ error: 'environment_not_found', message, hostname }`: a bare-string error
  with two stray top-level keys, and a lowercase code where error codes are
  `SCREAMING_SNAKE`. It is now
  `{ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message, details: { hostname } } }`.
  The `Accept: text/html` branch still serves the styled 404 page, unchanged.
  
  **The cross-adapter reference implementation moved with it.**
  `@objectstack/http-conformance`'s zero-dependency `NodeHttpServer` mirrors the
  adapter's unmatched-request bodies byte-for-byte on purpose — the whole point
  of that package is proving the transport port is free of framework-isms, and
  `fallback-seam.conformance.test.ts` runs the same cases against both. Leaving
  it behind would have made "both adapters agree" false in the suite that exists
  to assert it.
  
  Every converted body is judged by `scripts/check-route-envelope.mjs`, whose
  per-file counters for these three modules go to zero and are banked as
  conformant. The literals are deliberately written INLINE at each `c.json(...)`
  call rather than hoisted into shared constants: the gate reads the object
  literal, and an identifier reads to it as a relayed body it must not police —
  hoisting would have zeroed the counters by hiding the bodies from the scanner
  instead of by conforming them.

### Patch Changes

- c1731d0: `/auth/me/permissions` and `/me/apps` now resolve the caller's permission sets by
  calling `ISecurityService.resolvePermissionSetsForContext` on the `security`
  service, instead of re-implementing that resolution twice locally.
  
  The endpoints previously composed the requested set names themselves (positions ∪
  explicit sets ∪ the deployment baseline), built their own `sys_permission_set` DB
  loader, and called the permission evaluator directly — one rule in three copies,
  which diverged from the enforcement path three times, each divergence found only
  after it reached a user. They now project a single resolution owned by the
  enforcement path.
  
  Behaviour is unchanged on the ordinary paths, measured on the wire. Three states
  change, all of them states where the UI plane previously disagreed with the data
  plane:
  
  - A deactivated `sys_permission_set` row whose name matches a live position name
    no longer grants capabilities, tabs or object access on these endpoints. It
    already granted nothing on the data plane.
  - A permission set with a malformed JSON column is no longer dropped whole by
    `/auth/me/permissions`; the malformed column degrades on its own, as it already
    did for the data plane and for `/me/apps`.
  - A stack whose SecurityPlugin started in degraded mode (no middleware-capable
    engine, so the `security` service is never registered and nothing is enforced)
    now takes the endpoints' documented degraded branch instead of reporting a
    restrictive map computed against enforcement that does not exist.
  
  `plugin-hono-server` still takes no runtime dependency on `plugin-security`: the
  resolution is reached through the service locator, and the degraded branches for
  a stack with no SecurityPlugin are unchanged.
- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- 1e050a5: fix(observability): emit `http_request_duration_ms` from the transport seam, so
  p95 latency sees every inbound surface instead of dispatcher routes only
  (#9834)
  
  #9835 moved `http_requests_total` to the `IHttpServer.afterResponse` seam and
  stopped there, which left the two derived signals the operator guidance names
  inconsistent with each other: 5xx rate covered auth's `getRawApp()` mount and
  the REST data API, while p95 latency still saw only the routes the dispatcher's
  own `Proxy` wrapped. A missing latency panel is at least loud; the worse
  reading is the p95 that IS drawn, computed from dispatcher routes only and
  presented as the server's.
  
  - `@objectstack/observability`: new `armHttpRequestDurationHistogram(server,
    metrics)`, the duration family's counterpart to `armHttpRequestCounter` —
    same `afterResponse` seam, its own `Symbol.for` first-wins latch, so a host
    that armed one family can still arm the other. `ArmHttpMetricResult` is the
    family-neutral spelling of the result union; `ArmHttpRequestCounterResult`
    stays as an alias.
  - `@objectstack/plugin-hono-server`: `installHttpMetricsSeam` arms both
    families, so the transport owns every transport-observable HTTP metric in the
    shipped composition rather than splitting ownership across layers.
  - `@objectstack/runtime`: the dispatcher offers its registry to the histogram
    seam as well, and `instrumentRouteHandler` gains
    `emitHttpRequestDurationMs` (default `true`) — passed `false` exactly when
    the transport implements the seam, which is what keeps the dispatcher's own
    routes at ONE observation instead of reintroducing the #9833 double count one
    family over.
  
  **⚠️ The observation window changes with the emitter.** The per-route wrapper
  timed `await handler(req, res)` — handler latency. The transport times from
  first seeing the request to the response existing, so the middleware chain and
  body parse are now included and samples can only move UP. This is the number a
  latency panel should show (the request's latency, not one layer's share of it),
  but it is a visible shift in an existing series: compare p95 across the upgrade
  boundary deliberately. Documented in `docs/OBSERVABILITY.md` and the
  production-readiness guide.
  
  `http_request_errors_total` is deliberately NOT moved. The observation carries
  no throw signal — only `{method, routePattern, status, elapsedMs}` — so a
  transport-side emitter would have to key off a status class, which counts a
  different population than "the handler threw". That is a semantics decision,
  recorded on #9834 rather than guessed at here; the counter stays ungated on
  every transport and keeps its documented meaning.
- 7ff3975: feat(spec): `IHttpServer` gains an optional `afterResponse` response-observing
  hook so HTTP metrics are transport-agnostic instead of Hono-only (#9835)
  
  The contract addition (additive — a new optional member plus the
  `HttpResponseObservation` / `HttpResponseObserver` types and the reserved
  `UNMATCHED_ROUTE_PATTERN` label): a transport invokes each registered observer
  exactly once per answered request with `{ method, routePattern, status,
  elapsedMs }`, after the response exists — the observation point the `use()`
  middleware contract cannot express (it runs before dispatch and never sees a
  status). `routePattern` is REQUIRED to be the registered route pattern
  (`/api/v1/data/:id`), never the concrete path, so no adapter re-decides metric
  cardinality. Optionality is feature-detected runtime-real
  (`typeof server.afterResponse === 'function'`); a transport that does not
  implement the seam reports **no** HTTP metrics — zero there means "not
  instrumented", never "no traffic".
  
  Implementations and consumers in the same change:
  
  - `@objectstack/plugin-hono-server`: `HonoHttpServer` implements the seam (the
    ruled #9650 raw-app middleware becomes its delivery path — same reach,
    including `getRawApp()` mounts and middleware-refused 429s); unrouted
    requests are now labelled with the reserved `unmatched` pattern (previously
    they could surface as `/*`).
  - `@objectstack/observability`: new `armHttpRequestCounter(server, metrics)`
    arms the `http_requests_total` counter through the seam at most once per
    server (first caller wins), which is what makes "exactly one counter per
    server" structural.
  - `@objectstack/runtime`: the dispatcher offers its `observability.metrics`
    registry to the seam (a host that wires only the dispatcher now counts every
    inbound surface) and suppresses its own per-route copy of
    `http_requests_total` when the transport implements the seam — retiring the
    #9833 double count. Request-id echo, the duration histogram, the error
    counter and the error reporter are unchanged.
  - `@objectstack/http-conformance`: `NodeHttpServer` implements the seam, and a
    new cross-adapter conformance suite locks the semantics for both adapters.
  - `@objectstack/core`: re-exports the new contract types/constant.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [899052a]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/observability@17.1.0

## 17.0.0

### Major Changes

- 29c6c9d: feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

  The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
  about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
  accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
  The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
  paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
  404, because **no route was ever mounted** for a declared path, so the request died at
  Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
  metadata service and called `matchEndpoint` on it — a method **no implementation in the
  repo has ever provided**. The branch returned "not handled" on every request ever served.

  So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
  mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
  `inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
  **`authRequired`**, a security semantic that parsed green and gated nothing at all. That
  is false compliance, the failure ADR-0049 exists to stop, not debt.

  ## BREAKING — a non-empty `apis:` is now rejected

  Metadata that parsed cleanly before is now **refused at publish/validate**, with the
  prescription in the rejection itself:

  ```
  apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
  so a non-empty array is rejected instead of silently accepted (#4936). …
  ```

  **FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
  accepted, and an empty array is not a special case). To actually serve the route today,
  mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
  route. That is now the only honest path, and the one `examples/app-showcase` uses
  (`src/system/server/recalc-endpoint.ts`).

  The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
  point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
  `os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
  forgot to check.

  **The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
  rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
  re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
  and stay in the spec; only _authoring them into a stack_ is refused, and only until the
  executor lands. Keep them commented next to your stack — that is what the showcase does.
  The executor (route mounting + endpoint matching + per-key wiring for
  `authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
  **#5040**, which replaces this rejection with real execution.

  ## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

  The repo carried a **second**, unrelated declaration shape for "an API endpoint":
  `ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
  `createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
  assembly site lived in `packages/core/examples/`, with no registration in
  `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
  such service. The whole family was therefore inert, including
  `ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
  that "the gateway layer automatically validates these permissions" while no gateway read
  it. Two declaration shapes, both dead; this retirement converges them on one.

  Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
  `ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
  `ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
  `ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
  `ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
  Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
  Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
  defaulted to `true` and read by nothing, configuring a service that was never composed.

  **FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
  old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
  you were building a value only your own code read — keep it as your own type. Declarative
  endpoints have one vocabulary now, `ApiEndpointSchema`.

  `ConflictResolutionStrategy` **survives** the removal and moved to
  `@objectstack/spec/api`'s `router.zod` — same name, same four values
  (`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
  independent ratchets and is not part of the retired surface.

  ## Also in this change

  - **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
    along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
    `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
    removal — but it returned `{ handled: false }` for every call it ever received, so no
    caller can observe a behaviour change beyond the missing symbol. Delete the call.
    Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
    at runtime with dead code behind it.
  - `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
    longer claims the capability is `demonstrated` — that entry read "executed by the runtime
    dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
    claim Prime Directive #10 forbids.
  - The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
    the live executor card, instead of #4936, which closes with this change.

- e5a4d26: feat(plugin-hono-server)!: delete the CRUD/discovery convenience surface and the `registerStandardEndpoints` flag — the plugin is a transport adapter (#4073)

  Completes the retirement. `HonoServerPlugin` now owns the socket, the middleware
  and the three current-user endpoints, and nothing else. The data and discovery
  APIs have one owner each: `@objectstack/rest` and the runtime dispatcher
  (ADR-0076 D11).

  **Removed**

  - `POST/GET /api/v1/data/:object` and `GET /api/v1/data/:object/:id` — the raw
    C+R surface that delegated straight to ObjectQL.
  - `GET /api/v1/discovery` and `GET /.well-known/objectstack` — this plugin's
    third discovery payload, which predated `DiscoverySchema` and could not
    satisfy it (no `services`, the ADR-0076 D12 source of truth).
  - The `registerStandardEndpoints` option. It is gone, not defaulted off: passing
    it is now a type error, and passing it via `as never` mounts nothing.

  **Unaffected**

  - `/auth/me/permissions`, `/auth/me/localization` and `/me/apps` — this plugin
    is the platform's only supply and they register unconditionally (#4144).
  - Every composed host: `os serve`, `objectstack dev`, cloud's objectos and every
    documented composition mount REST and/or the dispatcher, which already served
    these routes and answered byte-identically with the flag on or off (#4260).

  **Migration** — only a host that mounts `HonoServerPlugin` with neither owner is
  affected. It now has no data or discovery API, and the boot warns once naming
  both remedies. Mount `createRestApiPlugin` from `@objectstack/rest` for full
  CRUD behind the gate stack, or `createDispatcherPlugin` from
  `@objectstack/runtime`. There is no flag to opt back in.

  **Why** — the surface was duplicate and lesser supply (C+R only, a subset of the
  gates, a non-conforming discovery payload), and it charged rent: #2567, #3298
  and #4018 each had to re-implement a platform invariant on it after the fact,
  because a second implementation of a route is a second place every future
  invariant must be remembered.

### Minor Changes

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- 545d931: fix(plugin-hono-server): the current-user endpoints answer from the kernel that OWNS the request (cloud#927)

  `/api/v1/auth/me/permissions`, `/auth/me/localization` and `/me/apps` resolved
  their answer from the service locator captured at REGISTRATION time. On a
  single-environment host that is the only kernel, so it is right. On a
  **multi-tenant** host it is the routing shell — and identity is not there.
  cloud's `ArtifactKernelFactory` mounts `AuthPlugin` per environment, and its host
  kernel deliberately has none ("AuthPlugin is intentionally NOT injected on the
  host"), so `getService('auth')` threw, the session resolver fell to its catch, and
  every authenticated tenant caller got `{authenticated:false}`.

  That is worse than an error: objectui's `MePermissionsProvider` reads
  `authenticated:false` as ANONYMOUS and keeps its permissive default
  (`return data.authenticated !== true`), because a guest surface has no resolvable
  permissions by design. So the console's FLS / `apiOperations` hints were
  systematically wrong — not a bypass (the server still enforces per request), but
  exactly the client/server divergence `foldWildcardSuperUser` and
  `clampManagedObjectWrites` exist to close, one layer up.

  These endpoints now consult the host's ADR-0006 **`kernel-resolver`** seam per
  request — the same seam the runtime dispatcher has used since Phase 5, so
  multi-tenant routing has one strategy rather than two:

  - **No `kernel-resolver` registered** → unchanged. Single-environment hosts,
    `os serve`, and the QA conformance host see no difference.
  - **A kernel** → that kernel's `auth` / `objectql` / `metadata` /
    `security.permissions` answer.
  - **`undefined`** → the registration-time locator, which is the seam's contract
    for an unscoped / control-plane request.
  - **A throw** → no answer at all: the thrown status when it carries one (cloud's
    `KernelWarmingError` is 503 + `Retry-After`), else 503
    `environment_unavailable`. Falling back to the default kernel would hand back a
    confidently-wrong `{authenticated:false}` that the client fails OPEN on.

  The seam is read **lazily, per request**, never captured at registration — a host
  may register these routes before `kernel.bootstrap()` (to outrank an
  `/api/v1/auth/*` wildcard), which is before the plugin that registers the
  resolver has run its `init()`.

  **FROM → TO for host adapters.** `CurrentUserEndpointsContext` gains an optional
  `getKernel(): unknown`, the `defaultKernel` argument the seam takes. A
  `PluginContext` already satisfies it, so hosts that mount `HonoServerPlugin` need
  no change. A host passing a hand-rolled locator to
  `registerCurrentUserEndpoints` should add it:

  ```diff
   registerCurrentUserEndpoints({
     rawApp: httpServer.getRawApp(),
  -  ctx: { getService: (n) => kernel.getService(n) },
  +  ctx: { getService: (n) => kernel.getService(n), getKernel: () => kernel },
   });
  ```

  Without it a multi-tenant host cannot be asked which kernel owns the request and
  keeps the old provenance — a silent downgrade, so it is worth adding even where
  the host is single-environment today.

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- 2649ccb: feat(runtime,hono): 挂载 seam —— `setFallbackHandler` 实现 + 声明式端点派发步(#5040 E3, #5090)

  给声明式 `apis:` 端点铺上**唯一一条**能进入处理器的通路,并且这条通路在构造上不可能遮蔽任何
  已注册路由。执行器本身尚未落地,本次改动**零现网行为变更**:任何 stack 目前都无法发布非空
  `apis:`(publish 硬拒,直到 #5040 E7 翻转),所以这里新增的一切在真实组合里结构性不可达。

  **`@objectstack/plugin-hono-server` —— `IHttpServer.setFallbackHandler` 的实现**

  契约(#5080 落在 `@objectstack/spec/contracts`)的四条保证逐条兑现:

  - 映射到 Hono 的 `app.notFound` 钩子,**不是**通配路由。这是全部要点:通配路由要与之后注册
    的每一条路由竞争,而 Hono 按先注册者赢裁决,归属就变成插件 `start()` 顺序的函数 ——
    ADR-0076 D11 正是为此存在。兜底器只在全部显式路由未命中后运行,**零注册顺序依赖**。
  - handler 拿到的 `req.body` **可读**(与 `use()` 中间件 seam 相反,后者的契约明确不填充
    body),按 content-type 解析,与真实路由处理器走同一段代码。
  - 重复安装即**替换**,不成链。
  - handler 不写响应 → 适配器既有的未命中答案(404,或方法不匹配时 405 + `Allow`)原样保留。

  配套的一处属主收敛:404/405 应答此前由 `HonoServerPlugin.start()` 直接写在
  `getRawApp().notFound(...)` 上。`app.notFound` 是后调用者覆盖,兜底 seam 落在同一个钩子上,
  两个写入方意味着幸存者由插件启动顺序决定 —— 应答本体因此移入 `HonoHttpServer`
  (`installNotFoundSeam()` / `setFallbackHandler()` 在其中组合),一个钩子一个属主。行为
  逐字节不变(`notfound-405.test.ts` 原样通过)。

  顺带修好同一段代码上的两处不一致:适配器构造的 `IHttpRequest` 现在一律带
  `remoteAddress`(此前只有中间件 seam 有,同一个契约有两种形状);处理器**同步**抛出与
  异步 reject 现在报同一种结果(此前同步抛出会逃到 Hono 自己的错误页)。

  **`@objectstack/runtime` —— dispatcher 端点派发步**

  dispatcher-plugin 在 `start()` 中探测 `typeof server.setFallbackHandler === 'function'`
  并注册兜底器。对落在 ADR-0121 D1 保留段 `<prefix>/apps/<命名空间>/<子路径>` 下的请求,
  探测 `metadata` 服务的 `matchEndpoint`(#5089 的实现在并行开发,探测缺席即穿透):

  - **命中** → `501 NOT_IMPLEMENTED`,包络说明执行器随 17.x 落地(#5040 E4–E5 接策略键与
    执行目标);
  - **未命中 / 无 matcher / 无 metadata 服务 / 路径不在挂载前缀下** → **不写任何响应**,
    传输层既有的 404/405 答案原样成立(有回归测试逐字节钉住);
  - `matchEndpoint` 抛错按 5xx 出口应答,不降级为 404 —— 故障不得伪装成「没有这条路由」。

  派发步**不重入** `dispatch()`:那条管线会解析环境与 `executionContext`、跑匿名拒绝门、并以
  语义 404 收尾,把全部未命中请求灌进去会改变今天未命中请求的答案。裸 404 与语义 404 的收口
  是另一个决定,本次刻意不做。

  `route-ledger.ts` 新增 `* /apps/**` 登记行与 `NON_DISPATCH_MOUNT_PREFIXES`(本包在
  `dispatch()` 之外挂载的前缀),注记如实描述已接线的部分与**尚未**接线的执行部分;新增
  一致性测试钉住 ADR-0121 D1 赖以成立的事实 —— `/apps` 不属于任何内建域。

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

  <!-- adr-0087: registered export-axis-opt-in -->

- d4720ca: feat(plugin-hono-server): export `registerCurrentUserEndpoints` so a host without the plugin can still supply them (cloud#924)

  `GET /api/v1/auth/me/permissions`, `/api/v1/auth/me/localization` and
  `/api/v1/me/apps` are the platform's **sole** supply — neither
  `@objectstack/rest` nor `@objectstack/runtime` registers any `/me/*` route, the
  objectui console reads the first for its whole permission layer and the second
  for regional defaults, and `core`'s auth gate allow-lists the last two as
  endpoints a gated user MUST still reach. #4073/#4079 freed them from the
  `registerStandardEndpoints` flag, but left the supply welded to
  `HonoServerPlugin`: a host that stands up a bare `HonoHttpServer` and registers
  it as `http.server` itself — rather than mounting the plugin — got no provider at
  all, and the console's FLS / `apiOperations` had no server-side answer on that
  startup path.

  Registration needs a Hono app and a service locator, not ownership of the
  listening socket, so it is now a standalone module (`./current-user-endpoints`)
  that both shapes call:

  ```ts
  import { registerCurrentUserEndpoints } from "@objectstack/plugin-hono-server";

  const httpServer = new HonoHttpServer();
  kernel.registerService("http.server", httpServer);
  registerCurrentUserEndpoints({
    rawApp: httpServer.getRawApp(),
    // any { getService, logger } — a PluginContext satisfies it structurally
    ctx: {
      getService: (n) => {
        try {
          return kernel.getService(n);
        } catch {
          return undefined;
        }
      },
    },
  });
  ```

  It is **idempotent**: it returns `false` and registers nothing when all three
  paths are already served, so a host may both call it eagerly on the raw app AND
  mount the plugin — the plugin's `kernel:ready` registration then no-ops instead
  of shadowing the host's routes with dead duplicates. Registering early matters,
  because Hono's only route precedence is first-registration-wins and plugin-auth
  mounts a `/api/v1/auth/*` wildcard that `/auth/me/*` must outrank.

  **No behaviour change for existing hosts.** `os serve` and every host that mounts
  `HonoServerPlugin` register the same three routes, in the same `kernel:ready`
  position, with the same response shapes — the plugin now delegates to the shared
  registrar instead of owning a private method.

  **Moved exports (same package, same names, no rename).** `foldWildcardSuperUser`,
  `clampManagedObjectWrites`, `seedSuperUserRestrictedObjects`,
  `annotateEffectiveApiOperations`, `ManagedSchemaLike` and `ApiExposureSchemaLike`
  now live in `./current-user-endpoints` alongside the endpoint they shape. Importing
  them from the package root (`@objectstack/plugin-hono-server`) is unchanged; only a
  deep import of `.../dist/hono-plugin` would need updating, and the package exposes
  no such subpath.

- 43ff598: fix(plugin-hono-server): stop gating the current-user endpoints behind `registerStandardEndpoints` (#4073)

  `registerStandardEndpoints` gated two unrelated things behind one flag:

  - **Duplicate supply** — raw `POST/GET /api/v1/data/:object` (create + read
    only), which `@objectstack/rest` also serves and, registering first, is what
    actually answers; plus `GET /api/v1/discovery` and
    `/.well-known/objectstack`, which the dispatcher and REST own and which this
    surface already cedes to them (#4018).
  - **Sole supply** — `GET /api/v1/auth/me/permissions`,
    `/api/v1/auth/me/localization` and `/api/v1/me/apps`. Nothing else in the
    platform mounts these: neither `@objectstack/rest` nor `@objectstack/runtime`
    registers any `/me/*` route, the console's entire permission layer reads
    `/auth/me/permissions`, the console reads `/auth/me/localization` for regional
    defaults, and `core`'s auth gate allow-lists `/me/apps` + `/me/localization`
    as endpoints a gated user MUST still reach to bootstrap the remediation UI.

  `os serve` gets all of it only because the flag defaults to `true` — the CLI
  constructs `new HonoServerPlugin({ port })`. So `registerStandardEndpoints:
false`, whose documented job is the optional CRUD/discovery convenience surface,
  silently took the console's permissions and localization down with it.

  The three current-user endpoints now register **unconditionally**, and the flag
  covers the duplicate half only — what its name and docs always claimed.

  **FROM → TO.** If you set `registerStandardEndpoints: false` and worked around
  the missing endpoints (proxying `/auth/me/permissions` yourself, or pinning the
  flag to `true` purely to keep them), you can drop that workaround: the endpoints
  are now present either way. No route is removed and no response shape changes,
  so a host that left the flag at its default sees no difference. If you relied on
  `false` meaning "this plugin mounts no `/api/v1` routes at all", that is no
  longer true — it never was for `os serve`, which is the only host that shipped
  the flag's default.

  Also removes three unreferenced `*_ENDPOINT_PRIORITY` constants;
  `DISCOVERY_ENDPOINT_PRIORITY = 900` in particular implied a route-priority
  mechanism that does not exist (precedence here is Hono's
  first-registration-wins).

- 623e555: feat(plugin-hono-server): `registerStandardEndpoints` now defaults to `false` — the deprecated CRUD/discovery convenience surface is opt-in (#4073)

  The flag mounts raw C+R `/api/v1/data/:object` and `/api/v1/discovery` /
  `/.well-known/objectstack`. Every path it mounts is duplicate — and lesser —
  supply: C+R only, a subset of the gates, a pre-`DiscoverySchema` discovery
  payload. `@objectstack/rest` serves full `/data` CRUD behind the whole gate
  stack, REST/the dispatcher own discovery (#4018 cede), and #4260 pinned that a
  composed host answers **byte-identically** with the flag on or off. The surface
  has also been a standing tax: #2567, #3298 and #4018 each had to re-implement a
  platform invariant here after the fact.

  **FROM → TO**

  - **Composed hosts (REST and/or the dispatcher mounted)** — `os serve`,
    `objectstack dev`, cloud's objectos, every documented path: **no change**.
    Those plugins already answer every route this surface covered, and answered
    them first.
  - **Bare hosts (HonoServerPlugin only)**: `/api/v1/data/:object`,
    `/api/v1/discovery` and `/.well-known/objectstack` are **no longer mounted by
    default**. The boot now logs a warn naming the flag and the remedy instead of
    leaving a silent 404. Migrate by mounting `createRestApiPlugin` from
    `@objectstack/rest` — it needs the same `objectql` service this surface
    already required, and returns full CRUD plus the gate stack — or pass
    `registerStandardEndpoints: true` to keep the legacy surface during the
    deprecation window.
  - The current-user endpoints (`/auth/me/permissions`, `/auth/me/localization`,
    `/me/apps`) are **unaffected** — they never sat behind this flag (#4144) and
    register unconditionally.

  The flag is now marked `@deprecated`. Next step per #4073: one release of
  observation, then `registerDiscoveryAndCrudEndpoints` (and the flag) are deleted
  and this plugin becomes a pure transport adapter (ADR-0076 D11).

- 55dbbba: feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

  Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
  declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
  of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
  `@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
  that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
  outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
  tune did not exist (#4937). Neither half was broken; they were simply never connected, and
  both were documented as if they were.

  They are connected now, along one narrow path.

  ## What you write

  ```ts
  export default defineStack({
    manifest: {
      /* … */
    },
    server: {
      security: {
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
      },
      trustProxy: false,
    },
  });
  ```

  `server:` is a **new** top-level stack key. Nothing declared it before, so no existing
  stack changes behaviour on upgrade — there is no configuration that was inert yesterday
  and starts throttling today.

  It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
  nothing else, because those are the two keys with a consumer. It is NOT the nine-key
  `HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
  mounting them here would have made seven dead keys writable in one move (their
  enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
  budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
  is refused at `defineStack` rather than at 3am.

  **No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
  `objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
  the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
  built-in default.**

  ## What happens

  Every inbound request the server routes — REST, dispatcher, service routes, anything
  mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
  refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
  with a `Retry-After` computed from the bucket itself and the standard error envelope
  (`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

  The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
  anonymous traffic — so one abusive session cannot spend another user's budget, and
  credential-stuffing traffic (which has no principal yet) is still metered per source. That
  IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
  otherwise it is the transport's own peer address. Undeclared, those headers are attacker
  input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
  let them drain a chosen victim's.

  Counters live in the kernel `cache` service when one is registered, so a multi-node
  deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
  consume time so a cache plugin that registers later is still picked up (#4772). With no
  cache service at all it falls back to a per-process store and says so once, naming the
  consequence: the effective limit becomes the declared budget multiplied by the number of
  nodes, and nothing about the deployment looks wrong.

  ## Also in this change

  - **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
    passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
    middleware could not read the request, write a response, or decline to continue — a
    declared seam with no execution behind it, unnoticed because nothing called it. It now
    delivers method/path/query/headers plus the transport peer address
    (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
    registered before the routes it guards; the kernel's two-phase boot makes that automatic
    (`init()` before every `start()`).
  - **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
    does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
    in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
    now labelled as the reference material it always was rather than as live defaults.

  ## Explicitly NOT wired

  `ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
  **known-unwired**. Declaring them still changes nothing. They are not retired here either:
  the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
  key of a surface that may yet be implemented would only have to be undone. Tracked, not
  silent.

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

- d8c4957: feat: user-level export permission axis (#3544, #3391 follow-up)

  `export` is a user-gated operation, not just "anyone who can list". A permission
  set can now deny export on an object while keeping read — matching Salesforce
  "Export Reports" / Dynamics "Export to Excel" / NetSuite "Export Lists" / SAP
  S_GUI 61.

  - **spec** `ObjectPermissionSchema` gains an optional `allowExport` bit. It is
    deliberately OPTIONAL with **no default** so it is a backward-compatible
    opt-out: unset → inherits read (today's "can-list ⇒ can-export"), `false` →
    export denied while read is kept, `true` → granted.
  - **plugin-hono-server** `annotateEffectiveApiOperations` derives
    `userExportAllowed = allowExport !== false` from the resolved per-object
    permission and threads it into `resolveEffectiveApiMethods` — so `export`
    derives from `list ∧ userExportAllowed`. When the axis removes `export` from
    an otherwise-open object, the object is now annotated (the effective set minus
    `export`) so the client hides the Export button; an unrestricted object with
    export still allowed stays unannotated (client default-allow).

  Wires the `userExportAllowed` slot reserved in #3391 P1 — zero contract change
  to the derivation table or the frontend (it already consumes the effective
  `apiOperations`). Backward-compatible: existing permission sets (no
  `allowExport`) keep today's behavior everywhere.

### Patch Changes

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 51fb081: fix(hono-server): apply the baseline ADDITIVELY on `/auth/me/permissions` and `/me/apps` — the ADR-0090 D5 fallback cliff, one plane over (#7608)

  Both permission resolutions in `current-user-endpoints.ts` applied the deployment
  baseline permission set(s) only in a **second** `resolvePermissionSets` call gated on
  `resolved.length === 0`. That is the fallback **cliff** D5 abolishes, verbatim:

  > The fallback cliff is abolished. Today's semantics ("fallback applies only while the
  > user has _zero_ explicit grants") mean the first real grant silently removes the user's
  > baseline. `everyone` is additive like any other position: baseline ∪ explicit, always.

  `SecurityPlugin.resolvePermissionSetsForContext` — the **data** plane, one function call
  away — has pushed the baseline into `requested` and resolved once for as long as D5 has
  existed. These two endpoints had not, so the two planes disagreed the moment a member
  held any explicit grant at all.

  **What a user saw.** A member who received their **first** position or permission-set
  grant kept the baseline on the data plane and lost it on the **UI** plane.
  `/auth/me/permissions` reported object/field access narrower than a read actually
  returns, and `/me/apps` dropped every app whose `requiredPermissions` or tab visibility
  came from the baseline. Measured on the fixture that ships with this change — a member of
  one org, a baseline granting two capabilities, one explicit grant adding a third —
  receiving that grant took the member from **2 apps to 1**. It now takes them from 2 to
  **3**: the two baseline apps are retained instead of traded away, and the same member
  regains one readable object, one readable field and two capabilities on
  `/auth/me/permissions`. The fail-direction was **closed** (the console hid what the API
  allowed), which is why it read as cosmetic for as long as it did.

  The baseline names are now pushed into `requested` before the **single** resolution, in
  one shared `effectivePermissionSetNames` helper both handlers call — which retires the
  second `resolvePermissionSets` call outright rather than merely widening its guard: once
  the baseline is an input to the first call, a second call over a subset of those same
  names can add nothing. Unchanged: a member with zero grants still gets the baseline, a
  deployment declaring an empty baseline still resolves the caller's own names alone, and
  `/me/apps` still filters an app whose `requiredPermissions` nobody holds.

  No `principalKind === 'agent'` branch, unlike the plugin's copy, and that is a property
  of this surface rather than an omission — these endpoints are reached only through the
  better-auth **session** resolver, which never marks a principal kind, so an agent has no
  session to present here.

- 9c82146: fix(security): an app-declared permission baseline COMPOSES with the platform `member_default` instead of replacing it (#7555)

  A permission set marked `isDefault: true` used to become the deployment's ONLY
  baseline: `SecurityPlugin`'s `fallbackPermissionSet` held a single name, and an
  app's declared set went into it, so every member of that app silently lost the
  platform floor. Measured on the showcase (#7555): a fresh member is served all
  10 built-in Account nav entries and 7/7 of the objects behind them answer 403,
  because `showcase_member_default` names no `sys_*` object and `member_default`
  was no longer in force for anyone in that app.

  That is the ADR-0090 D5 fallback cliff in its second spelling — D5 rules the
  baseline additive without exception ("The fallback cliff is abolished. …
  `everyone` is additive like any other position: baseline ∪ explicit, always")
  and narrows `isDefault` to a package-authored _suggestion_, "never a runtime
  fallback".

  The human baseline is now the list of names it always was: the declared set
  **plus** the platform `member_default`, deduped. Both are pushed into the
  per-request resolution, both back the post-resolution fallback and the ADR-0106
  D7 metadata-plane resolution, and both are bound to the `everyone` audience
  anchor at boot so `security/explain` and the Setup UI report the default a
  request actually applies. The composed list is published as a new
  `security.baselinePermissionSets` service, which `/auth/me/permissions` and
  `/me/apps` read so the capability and tab surface cannot disagree with the data
  plane; `security.fallbackPermissionSet` is unchanged and still means "the single
  name this deployment declared".

  Deliberately unchanged:

  - **Agent principals** keep exactly their ADR-0090 D10 restricted ceiling — the
    composed human baseline is unreachable from `principalKind: 'agent'`.
  - **`fallbackPermissionSet: null`** still disables the baseline entirely; the
    composition never re-adds one.
  - **`member_default`'s own grant rows**, the D5/D9 high-privilege anchor-binding
    gate, and #5491's narrowing of the platform baseline to explicit-allow.

  An app that declares no `isDefault` set resolves `['member_default']` and is
  byte-for-byte unaffected.

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
  production-dependency batch from #3517

  **better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
  `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
  adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
  1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
  `scimProvider` model and the generate-token endpoint are gone), which is a
  feature migration, not a version bump. Its peer range accepts rc.2 core, and the
  advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

  **BREAKING — account identity.** better-auth renamed `account.accountId` to
  `account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
  resolves accounts by `(issuer, providerAccountId)`.

  - FROM `fields: { accountId: 'account_id' }` → TO
    `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
    account id keeps its `account_id` column — only the better-auth-side name
    moved — and `sys_account` gains an `issuer` column.
  - FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
    `createAccount({ providerId, issuer, providerAccountId, … })`. A local
    password account carries the issuer better-auth mints for itself,
    `local:credential`.
  - FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
    `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
    from `accounts.list()`), matching better-auth's narrowed body.
    `accounts.list()` returns `issuer` + `providerAccountId` in place of
    `accountId`.

  **Existing deployments:** rows written before 1.7 have no issuer and are
  invisible to sign-in until stamped. The auth plugin now runs an idempotent
  boot-time backfill that stamps what it can derive — `local:credential` for
  password accounts, `local:oauth:<providerId>` for configured social providers,
  and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
  Accounts from a federated IdP that is no longer registered cannot be derived;
  they are logged with their provider id and row count rather than guessed, and
  those users cannot sign in through that provider until the row is stamped with
  the IdP's issuer or removed so a fresh login re-links it.

  **Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
  now implemented over the kernel cache service — `getAndDelete` (single-use
  verification values) and `increment` (fixed-window rate-limit counter;
  `rateLimit.storage: 'secondary-storage'` throws at boot without it).

  The rest of #3517's production-dependency batch rides along: `@oclif/core`
  4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
  `pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 4dc14cc: Retire the three `security.*` dev stubs, and refuse to load `plugin-dev` under `NODE_ENV=production` (#4093).

  **The security stubs are gone.** When `@objectstack/plugin-security` was not installed, `plugin-dev` filled its three slots with fakes that inverted the decision each stood in for: `security.permissions.checkObjectPermission()` returned `true` for everything, `security.rls.compileFilter()` returned `null` so no row-level predicate was applied, and `security.fieldMasker.maskResults()` returned rows unmasked. ADR-0076 D12's rule — learned from the analytics shim it retired in #3891 — is that a fallback may degrade features, **never security semantics**; `packages/spec/src/contracts/security-service.ts` says the same from the other side (these three are plugin-security's internals, and access-narrowing answers must fail CLOSED). Since `plugin-dev` loads SecurityPlugin through the same optional dynamic import as everything else, the package merely being absent was enough to swap real RBAC/RLS/masking for allow-all behind a single `warn` line.

  The slots now stay empty — which is what production has without SecurityPlugin, and what every consumer already handles — and the boot log states plainly that RBAC, row-level security and field masking are not being enforced.

  **`plugin-dev` now refuses to initialize under `NODE_ENV=production`.** It is a published package that registers development fakes for every unclaimed core service slot, including ones that report success for work they never did, and it had no environment check of its own: an `objectstack.config.ts` carrying `new DevPlugin()` into a production deploy got the whole fake slate with only a boot log to say so. `init()` now throws there. Set `OS_ALLOW_DEV_PLUGIN=1` if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

  FROM → TO: a stack that relied on the dev security stubs was not being protected by them — it was being told everything was allowed. Install `@objectstack/plugin-security` to enforce RBAC/RLS/masking, or accept the empty slots (unchanged behaviour on every path that already handled an absent SecurityPlugin). A production process that loaded `plugin-dev` must now either drop it and install the real services, or opt in explicitly with `OS_ALLOW_DEV_PLUGIN=1`.

  Also: `plugin-hono-server`'s `/auth/me/permissions` resolves `security.permissions` and `metadata` through the same guarded lookup its three sibling lookups already used. An unregistered slot makes `getService` throw, which previously landed in the outer catch — the same fail-open response body, but logged as "/auth/me/permissions failed" on every console navigation instead of taking the deliberate `!evaluator` branch.

- c2d9098: feat(rest/protocol): extend droppedFields write-observability to the bulk paths + client SDK (#3455)

  Follow-up to #3448 (#3431 D2): the single-write PATCH/POST `/data` paths already
  surface LEGALLY-stripped write fields (static `readonly` #2948 / `readonlyWhen`
  #3042 / #3043 create ingress) as `droppedFields`. The **bulk** write paths did
  not — the same strips happened silently on every batched row — and the typed
  client warning + CORS mirror were deferred. This closes those out.

  **Bulk passthrough (metadata-protocol).**

  - `updateManyData` and `batchData` (update/upsert rows) now register a per-row
    `onFieldsDropped` collector and attach the events to that row's result.
  - `createManyData` diffs each supplied row against its #3043-stripped form and
    returns an **aggregated** top-level `droppedFields` (one event per
    object/reason with the union of field names) — its `{ records, count }`
    response has no per-row slot, and the insert-time strip is static-`readonly`
    only, so it is schema-uniform across rows and the aggregate is faithful.
  - `insertManyData` keeps per-row precision, attaching `droppedFields` to each
    outcome.
  - **Correctness fix bundled in:** `updateManyData` and `batchData` never threaded
    the caller's execution `context` to the engine — bulk writes ran context-less,
    so RLS/FLS and `readonlyWhen` evaluated without the caller's principal, and the
    batch create-ingress strip was hard-coded to a non-system context. All engine
    calls in both methods now run under the resolved `context`.

  **Contract (spec).** `BatchOperationResultSchema` gains an optional per-row
  `droppedFields` (covers `updateMany` + `batch`, which alias
  `BatchUpdateResponseSchema`); `CreateManyDataResponseSchema` gains the optional
  aggregated `droppedFields`. Both are omit-when-empty, so existing clients are
  unaffected. `X-ObjectStack-Dropped-Fields` is deliberately **not** emitted for
  batches — one response header cannot express per-row drops, so the per-row body
  field is the canonical bulk channel.

  **Typed client warnings (@objectstack/client).** `CreateDataResult` /
  `UpdateDataResult` gain `droppedFields?: DroppedFieldsEvent[]`, giving the body
  channel a type instead of an untyped property.

  **CORS (@objectstack/hono, @objectstack/plugin-hono-server).**
  `x-objectstack-dropped-fields` is added to the default `Access-Control-Expose-Headers`
  allow-list (kept in lockstep across both Hono CORS sites) so a cross-origin
  browser can read the single-write drop header. The body `droppedFields` remains
  the primary, cross-origin-safe surface — this is a convenience mirror.

  **GraphQL — not applicable (documented).** #3455 lists a GraphQL mutation item,
  but GraphQL has no runtime: `kernel.graphql` is unassigned everywhere and
  `handleGraphQL` returns `501`, and discovery never advertises `/graphql`. There
  is no schema generator or mutation resolver to expose a typed payload field on,
  so there is nothing to wire until a GraphQL engine lands — at which point the
  protocol-layer `droppedFields` is already present and only the GraphQL schema
  projection would remain.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- dfa8bad: 修复:逃出路由 handler 的抛出不再被静默丢弃 —— 适配器接缝现在有诊断出口

  `HonoHttpServer.runHandler()` 的兜底 `.catch` 此前把 rejection 显式丢弃(参数名就是 `_err`),`wrap()` 随后回一个 `{ error: 'No response from handler' }` 的 500。净效果是:**任何**逃出 handler 的抛出,在以本适配器为 transport 的 host 上都表现为一个不带原因的裸 500,而且**任何地方都没有日志** —— 连 stack 都没有。

  现在该接缝会按 `Logger` 契约打一条 `error` 记录,带上原始 `message` / `stack` 与定位所需的请求上下文(`method` + `path`)。

  - **`Error` 走契约的 `error` 形参槽**,不塞进结构化 meta。`Error` 的 `message` / `stack` 是 non-enumerable,直接进 meta 会序列化成 `{}` —— 那比没有日志更糟,因为它会报告成功。跨 realm 的 `Error`(`instanceof` 不成立)会按 `name`/`message`/`stack` 重建;`throw 'boom'` 这类非 `Error` 抛出会被描述进 message 而不是丢掉。
  - **请求体不入日志** —— 只有 `method` 和 `path`。
  - **默认就有日志出口。** 未接线时适配器用 `createLogger()`,而不是静默:直接内嵌 `HonoHttpServer` 的 host(serverless 入口)正是本问题的生产现场,静默默认会对它们原样复现该 bug。`HonoServerPlugin.init()` 会用 `ctx.logger` 替换掉默认值;要静默须显式传 `NoopLogger`。

  新增 `HonoHttpServer.setLogger(logger)`(纯新增,不改 `IHttpServer` 契约)。

  ⚠️ **响应形状一字未改**:兜底 body 仍是 `{ error: 'No response from handler' }` + 500,已加测试钉住。把它收成声明信封会改变线上响应形状,属另一项尚未裁决的契约决策,不随本次改动附带。

- 1fe436d: fix(plugin-hono-server): `/auth/me/permissions` resolves position-bound grants through the canonical resolver (#6334)

  On a hono host, `/api/v1/auth/me/permissions` and `/me/apps` resolved the caller
  through a standalone resolver in `current-user-endpoints.ts` that read
  `sys_member` + `sys_user_permission_set` — and **nothing else**. It never read
  `sys_user_position` / `sys_position_permission_set`, so a permission set bound to
  a **position** — the ADR-0090 D3 distribution mechanism, and how the showcase app
  grants every persona — was invisible to these endpoints: the response carried
  `positions: []`, omitted the set from `permissionSets`, and withheld its
  `systemPermissions`.

  That is the surface objectui's four `useCapabilityGate` gates read (toolbar, row
  kebab, record header, bulk bar — ADR-0066 D4), while the data plane resolves
  through SecurityPlugin's middleware on the canonical chain. So the server
  **granted** the action and the UI **hid the button** from a user who genuinely
  held the capability — the failure direction the fail-open design names as the
  worse one.

  A second, quieter half of the same divergence: the hand-rolled envelope published
  membership roles under `roles`, while `ExecutionContext` — and every reader in
  that file — calls the field `positions` (ADR-0090 D3, "formerly `roles`"). The
  endpoint's `positions` was therefore always `[]` and those names never reached
  `resolvePermissionSets` either, independently of the position tables.

  The session lookup (the genuinely transport-specific part) stays where it is; all
  grant aggregation now delegates to `resolveUserAuthzGrants`, the canonical
  resolver's userId-driven core, which `@objectstack/core` exports for exactly this
  caller shape — a surface that already knows who the principal is and needs the
  same envelope with no HTTP request to resolve it from. Arriving with it, none of
  it re-implemented: `sys_user_position` (null org = global, active-org match,
  ADR-0091 validity windows), the implicit `everyone` audience anchor (ADR-0090 D5),
  `sys_position_permission_set`, `mapMembershipRole` normalization, the
  platform-admin derivation and posture rung, and the `ai_seat` synthesis.

  No response-envelope change: `positions` / `permissionSets` / `systemPermissions`
  / `tabPermissions` keep their names and shapes, and now carry the grants the
  server was already enforcing.

- 7cdbcbb: fix(plugin-hono-server): surface a repeated query parameter as an array, matching the platform convention (#6878)

  **Behaviour change, not a refactor.** On the Hono server, a repeated query
  parameter — `?version=1.0.0&version=2.0.0` — used to reach your handler as the
  single string `'1.0.0'`. It now reaches it as `['1.0.0', '2.0.0']`. A
  single-valued key is unchanged: still a plain string.

  This is the ruled intent of #6878 (route 2, cli-lane seat ruling of
  2026-08-10), not an incidental cleanup.

  **Why the old behaviour was a problem.** The platform ships two `IHttpServer`
  implementations, and they answered the same request differently. The reference
  `NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array; the
  Hono adapter read `c.req.query()`, which returns only the first value per key.
  Both satisfied the declared contract — `IHttpRequest.query` is
  `Record< string, string | string[] >` — so neither had a bug, yet the
  platform's answer to "what is a repeated parameter?" depended on which server
  had booted.

  The consequence was not cosmetic. A handler cannot refuse an ambiguity it
  cannot see: #6307 found `DELETE /api/v1/packages/:id` silently narrowing a
  destructive operation's scope from a repeated `version`, and its fix (refuse
  repetition with a `400`) was unreachable on the Hono server because the
  transport had already collapsed the duplicate. Duplicates now reach the
  handler on both servers, where the rest-side gates landed in #6877 (PR #7324 —
  63 single-valued parameter slots) and #7321 (PR #7386) refuse them explicitly.

  **Both construction sites moved.** The adapter builds `IHttpRequest.query` at
  the route-handler seam _and_ inside the `use()` middleware seam; both now go
  through one `readQuery(c)` helper, so middleware and handlers agree.

  ⚠️ **If you read query parameters off the Hono server, check your assumptions.**
  A read point that assumed a string will now receive an array when — and only
  when — a client repeats that parameter. `String(req.query.x)` yields `"a,b"`
  and `Number(req.query.x)` yields `NaN` in that case. Handle the array, or
  refuse the repetition explicitly; do not reach back for the first value, which
  is the silent-wrong-answer shape #6878 set out to remove. The repo's own read
  points were swept and gated before this landed.

  Nothing in `packages/spec` changed: the declared union already permitted
  arrays. What changed is the platform's answer, from "depends on the server" to
  one answer.

  `@objectstack/http-conformance` gets the matching test tightening. Its
  cross-adapter case, added under #6878 route 1 (PR #6941) to _record_ the
  divergence, is collapsed into the single expected shape exactly as that file's
  own header instructed — plus a new middleware-seam case, so a half-applied
  change to only one of the adapter's two construction sites cannot pass. The
  single-value control case that catches an un-normalised `c.req.queries()`
  (which returns an array for every key, single-valued ones included) stays.

- 839982e: fix(plugin-hono-server): compute the standalone discovery `routes` from real registrations, and cede to the real owner (#4018)

  `registerStandardEndpoints` served a **fully static** discovery: a hardcoded
  `routes` table listing `auth` / `packages` / `analytics` / `workflow` /
  `automation` / `ai` / `notifications` / `i18n` / `storage` / `ui` regardless of
  what the host actually mounted. A standalone Hono deployment therefore
  advertised ten route families and 404'd on every one no plugin bridged — the
  "advertise a route that doesn't exist" class ADR-0076 D12 exists to kill, and
  the reason this surface disagreed with the two real discovery builders
  (`HttpDispatcher.getDiscoveryInfo`, `metadata-protocol`'s `getDiscovery`), which
  both compute per service at runtime.

  Two changes, no new discovery implementation to keep in sync:

  - **Single owner (D11 / OQ#9).** When `@objectstack/rest` or the runtime
    dispatcher is on the kernel, this surface no longer registers
    `${prefix}/discovery` — that plugin owns it. Both register during plugin
    `start()`, i.e. before this `kernel:ready` hook, and Hono is
    first-registration-wins, so they already shadowed this handler in every
    composed deployment: the cede changes no served payload, it removes a third
    one nobody read. `/.well-known/objectstack` is ceded to the dispatcher only
    (REST never registers it), so a REST-without-dispatcher host keeps the
    redirect.

  - **Computed, not hardcoded (D12).** When this surface does own `/discovery`,
    `routes` is derived per request from the app's live route table: a family is
    advertised iff a route is really registered at or under its base path. A
    wildcard mounted _above_ the base (global `/*` middleware, `/api/v1/*`) does
    not count as a mount.

  **What changes for you.** On a standalone `HonoServerPlugin` host (no REST, no
  dispatcher), `GET /api/v1/discovery` now omits every family nothing mounts —
  most visibly `routes.metadata`, since `/api/v1/meta` ships with
  `@objectstack/rest` / the dispatcher. Clients that read a route out of
  discovery and call it stop getting a 404; `@objectstack/client` falls back to
  the conventional path for any omitted key, so `client.connect()` is unaffected.
  Composed deployments (`os serve`, cloud) are unchanged — the dispatcher's
  service-aware discovery was already the one being served.

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- caf144a: ci(deps): OSV security batch 2026-08 — undici to 7.29.0, hono to 4.12.34,
  fast-uri to 3.1.5, so `Validate Package Dependencies` stops failing on every PR (#5032)

  Eight advisories (2 high, 6 medium) matched packages resolved in `main`'s
  `pnpm-lock.yaml`, and all eight name a fixed version:

  | advisory              | CVSS | package    | resolved         | fixed   |
  | --------------------- | ---- | ---------- | ---------------- | ------- |
  | `GHSA-7p8r-x3mc-p8w7` | 7.5  | `fast-uri` | 3.1.4            | 3.1.5   |
  | `GHSA-8j4g-w8fx-2239` | 5.3  | `hono`     | 4.12.32, 4.12.33 | 4.12.34 |
  | `GHSA-4cwx-7wf7-3272` | 7.4  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-jr45-8vmc-qm54` | 5.9  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-8xcm-r25x-g524` | 4.8  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-v3r7-h72x-cjcm` | 4.8  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-m8rv-5g2x-5cg5` | 4.2  | `undici`   | 7.28.0           | 7.29.0  |

  The OSV-Scanner step in `.github/workflows/validate-deps.yml` reads
  `pnpm-lock.yaml` directly and exits non-zero on any match, so the job was red on
  `main` itself and attached that red to every PR touching a manifest or the
  lockfile, whatever the PR contained (observed on #5027, whose own lockfile delta
  is three lines and resolves no new package). A permanently red gate is worse
  than no gate: the next PR that really does introduce a vulnerable dependency
  looks exactly like all the others.

  `undici` repeats the trap #4945 taught. The existing pin
  (`undici@>=7.23.0 <7.28.0: ^7.28.0`, added for `GHSA-vmh5-mc38-953g`) had
  settled on 7.28.0 — the version these five advisories affect — and its exclusive
  upper bound no longer covered it, so the override sat there doing nothing.
  Selector and target move together, to `<7.29.0` / `^7.29.0`. Transitive-only via
  `@vscode/vsce` > `cheerio`; `@ai-sdk/provider-utils` already resolved 7.29.0, so
  the two dedupe onto one copy. `jsdom`'s `undici` 8.9.0 is outside the selector
  and untouched.

  `fast-uri` is transitive-only through `ajv@8.20.0` (declares `^3.0.1`), reaching
  `@modelcontextprotocol/sdk`, `@objectstack/objectql`, `secretlint` and `table`;
  a `fast-uri@<3.1.5: ^3.1.5` override covers all of them.

  `hono` is the one that is not transitive-only, which is why this changeset
  releases something. Two versions were resolved: 4.12.32 from our own packages
  and 4.12.33 pulled by `@modelcontextprotocol/sdk`. The override moves the
  transitive copy and the declared ranges move with it — `@objectstack/plugin-hono-server`
  `dependencies.hono` to `^4.12.34` (the published-manifest change this patch
  covers), plus the `@objectstack/hono` and `@objectstack/plugin-auth`
  devDependencies. Overrides do not ship with published packages, so a declared
  range left behind would mean downstream resolves a version CI never ran —
  exactly what `scripts/check-override-consistency.mjs` exists to catch. The
  `@objectstack/hono` **peer** range stays the permissive `^4.12.8` on purpose: a
  peer states which host `hono` the adapter works against, and a host that pins an
  old one owns that copy. After the bump the workspace resolves a single
  `hono@4.12.34`.

  Scope is the eight advisories #5032 lists and nothing else. #4965 (advisories
  with no fix available, and the `osv-scanner.toml` exemption conventions that
  answer them) is a separate question — every advisory here has a fix, so this is
  an upgrade, not an exemption.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- cc3555e: Mount five ledgered-but-dead routes, and gate the class that hid them (#7526)

  Three routes shipped in the ledgers, implemented in the dispatcher, and mounted
  by nobody. Two of them answered a plausible `200` rather than a 404, which is
  worse: `GET /meta/types` fell into the `/meta/:type` catch-all and returned
  `{"type":"types","items":[]}`, shape-identical to `/meta/zzz_not_a_type`, and
  `GET /meta/:type/:name/published` fell into the compound-name route and
  returned a stub identical before publish **and for a name that does not exist**
  — a route that structurally could not 404. `GET /meta/objects/:name/state/:field`
  was the honest one: REST's `/meta` registrations topped out at three path
  segments and it needs four, so it answered Hono's `notFound`. All three now
  mount, `published` 404s for a bogus name, and the compound-name arity the SDK
  documents (`getPublished('lead', 'views/all_leads')`) mounts with it.

  The routes were the symptom. The route ledgers are a DECLARATION and every
  guard built on them (#3563 / #3587 / #3636 / #3642) reads that union as an
  OBSERVATION of what is mounted, so the whole audit chain was green on this
  class by construction — `/meta/objects/:name/state/:field` counted as mounted
  because it was ledgered. This adds the missing observation: a route-ledger ↔
  live-mount parity gate that boots a real server, reads the mount table off it,
  and asserts both directions — every ledgered route reachably mounted, every
  mounted route ledgered. It never consults a second hand-written list of what is
  mounted, and it PROBES reachability through the live router rather than
  checking presence in a table, because a literal route registered after a
  catch-all sibling is mounted and unreachable.

  `IHttpServer` grows two optional, feature-detected members for it —
  `getMountedRoutes()` (the live mount table, in registration order) and
  `resolveMountedRoute(method, path)` (which registration answers a concrete
  request, per the router itself) — implemented by the Hono adapter.

  The gate found three more instances of the same class on its first run:
  `GET /automation/actions`, `/automation/connectors` and `/automation/_status`
  were ordered ahead of the `/:name` catch-all inside `dispatch()`, with a
  comment saying the order was load-bearing, while the bridge that actually
  mounts `/automation` registered `/:name` and never those three. They now mount.
  It also found the unledgered live mounts: the four `/api/settings` routes get a
  ledger of their own, and `GET /.well-known/objectstack` and the object-less
  `POST /actions//:action` get rows in the dispatcher ledger.

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

- 2053714: fix(hono,plugin-hono-server,runtime): one CORS source and one registry key — the last derivable copies from the #3786 sweep

  Re-ran the sweep across all 72 packages. The earlier pass globbed `packages/*/src`,
  which is one level deep, so it missed everything under `packages/plugins/` and
  `packages/adapters/` — the "sweep is basically clean" report was based on an
  incomplete scan.

  **A stale CORS default, on the one description callers actually read.**
  `HonoCorsOptions.allowHeaders`' TSDoc promised
  `['Content-Type', 'Authorization', 'X-Requested-With']` "which is sufficient for
  cookie and bearer-token auth". The real default carries three more:
  `X-Tenant-ID` and `X-Environment-Id` (multi-tenant routing) and `If-Match` (the
  OCC token on record PATCHes, objectui#2572). Sizing a custom `allowHeaders`
  against that sentence drops all three and every cross-origin save fails with
  "Failed to fetch".

  The instructive part: **three** Hono CORS sites each carried their own copy of
  the defaults under "keep in sync" comments, and the copies all agreed. What
  drifted was the _doc_ — the only description with no counterpart to be diffed
  against, and the only one a caller reads.

  Both defaults are now single constants, `DEFAULT_CORS_ALLOW_HEADERS` and
  `DEFAULT_CORS_EXPOSE_HEADERS`, exported from `@objectstack/plugin-hono-server`
  and imported by the adapter (which already depends on it — no new edge). The
  TSDoc links them rather than restating, and documents an asymmetry it never
  mentioned: `allowHeaders` REPLACES the default, `exposeHeaders` MERGES with it.

  `hono-plugin.test.ts` stopped stubbing `./adapter` wholesale and keeps the real
  constants via `importOriginal` — it asserts exact header lists, so a mocked copy
  would make the test agree with itself rather than with what ships. Verified:
  removing `If-Match` from the constant fails `should allow If-Match by default`,
  by name.

  **A third copy, in the public protocol docs.** `content/docs/protocol/kernel/
http-protocol.mdx` advertised `Access-Control-Allow-Headers: Authorization,
Content-Type` — two of the six — and methods missing `PUT` and `HEAD`, with no
  mention of the exposed headers at all. That is the copy an integrator builds a
  client against: reading it, you would not know `If-Match` is permitted (so you
  would not attempt OCC) or that `set-auth-token` is readable (so a rotated
  session would look like a bug). Corrected, with the three non-obvious allowed
  headers and the two exposed ones explained, and a pointer to the constants as
  the source of truth.

  **A hand-copied service-registry key.** `runtime`'s share-links domain resolved
  `'shareLinks'` as a string literal, copied from `SHARE_LINK_SERVICE` — whose own
  doc-comment says "keep in sync with the SharingPlugin registration". It now
  imports the constant. A drifted copy resolves nothing, so every share link
  answers 501 "Sharing is not configured for this environment" on an environment
  where it is configured perfectly well.

  **Plus a duplicate ledger entry**, which is the same defect one level up:
  `check-generated.ts` carried two `NO_GENERATOR` entries for
  `check:strictness-ledger`, because #4203 and #4252 each added one without seeing
  the other. Functionally harmless (the ledger is read into a `Set`) but it leaves
  two comments telling overlapping versions of the same story. #4203's is kept —
  it is the more complete account and it is the PR that fixed the underlying
  problem.

  Checked and deliberately left alone: `ApprovalStatus` (5 values) and
  `ApprovalActionKind` (12 values) versus their `plugin-approvals` selects — diffed
  verbatim, no drift today, still hand-copied across a package boundary.

- b9f930b: feat(spec): `userActions.create` / `.import` accept the same CEL-predicate object form as `edit` / `delete` (#7692)

  #3076 (objectui#2614) gave `userActions.edit` and `userActions.delete` a
  boolean-or-predicates union so the built-in row affordances could be gated on
  record state. `create` and `import` were left as bare booleans, and there was no
  other lever for them — which means a child object's related-list `[+ New]` button
  could not be gated on the parent record's state at all, while the row `Edit` /
  `Delete` beside it could. On a frozen parent the row actions correctly grey out
  and `[+ New]` still renders; the server-side guard rejects the insert, so this is
  an affordance leak rather than a data-integrity hole, but it is one an app has no
  way to close.

  Both keys now take the union `edit` / `delete` already carry — the **same**
  `RowCrudActionOverrideSchema`, not a new dialect:

  ```ts
  userActions: {
    create: { visibleWhen: 'record.version_status == "draft"' },
    import: { enabled: true, disabledWhen: 'record.frozen == true' },
  }
  ```

  `enabled` keeps the bare boolean's meaning (omitted → the `managedBy` bucket
  default), `visibleWhen` is fail-closed and `disabledWhen` fail-soft, exactly as
  for the row pair. `resolveCrudAffordances` carries the predicates through as
  `createPredicates` / `importPredicates`, alongside the existing
  `editPredicates` / `deletePredicates`.

  **What `record.*` binds to differs between the two positions, and the schema says
  so rather than implying symmetry it does not have.** `edit` / `delete` evaluate
  per row against that row's own record. `create` / `import` gate a record that does
  not exist yet, so they evaluate once per toolbar against the record in scope where
  the toolbar renders — the host (parent) record on a record page's related list,
  and nothing at all on a standalone object list, where a predicate reading
  `record.*` therefore hides the button under the fail-closed rule.

  Back-compatible: the boolean forms parse and resolve exactly as before, and the
  boolean-only path still produces no predicate keys. Unknown keys inside the object
  form are rejected, same as for `edit` / `delete`.

  `@objectstack/plugin-hono-server` tracks the widened producer: the `/me/permissions`
  managed-write clamp tested `create` with a bare `!== true`, which would have clamped
  away a legitimate `create: { enabled: true, visibleWhen: … }` opt-in; it now reads
  `create` through the same opt-in helper as `edit` / `delete`.

  The renderer half — the related-list toolbar honouring `create.visibleWhen` — is
  objectui's downstream card and is not part of this change.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/observability@17.0.0

## 17.0.0-rc.6

### Patch Changes

- 1fe436d: fix(plugin-hono-server): `/auth/me/permissions` resolves position-bound grants through the canonical resolver (#6334)

  On a hono host, `/api/v1/auth/me/permissions` and `/me/apps` resolved the caller
  through a standalone resolver in `current-user-endpoints.ts` that read
  `sys_member` + `sys_user_permission_set` — and **nothing else**. It never read
  `sys_user_position` / `sys_position_permission_set`, so a permission set bound to
  a **position** — the ADR-0090 D3 distribution mechanism, and how the showcase app
  grants every persona — was invisible to these endpoints: the response carried
  `positions: []`, omitted the set from `permissionSets`, and withheld its
  `systemPermissions`.

  That is the surface objectui's four `useCapabilityGate` gates read (toolbar, row
  kebab, record header, bulk bar — ADR-0066 D4), while the data plane resolves
  through SecurityPlugin's middleware on the canonical chain. So the server
  **granted** the action and the UI **hid the button** from a user who genuinely
  held the capability — the failure direction the fail-open design names as the
  worse one.

  A second, quieter half of the same divergence: the hand-rolled envelope published
  membership roles under `roles`, while `ExecutionContext` — and every reader in
  that file — calls the field `positions` (ADR-0090 D3, "formerly `roles`"). The
  endpoint's `positions` was therefore always `[]` and those names never reached
  `resolvePermissionSets` either, independently of the position tables.

  The session lookup (the genuinely transport-specific part) stays where it is; all
  grant aggregation now delegates to `resolveUserAuthzGrants`, the canonical
  resolver's userId-driven core, which `@objectstack/core` exports for exactly this
  caller shape — a surface that already knows who the principal is and needs the
  same envelope with no HTTP request to resolve it from. Arriving with it, none of
  it re-implemented: `sys_user_position` (null org = global, active-org match,
  ADR-0091 validity windows), the implicit `everyone` audience anchor (ADR-0090 D5),
  `sys_position_permission_set`, `mapMembershipRole` normalization, the
  platform-admin derivation and posture rung, and the `ai_seat` synthesis.

  No response-envelope change: `positions` / `permissionSets` / `systemPermissions`
  / `tabPermissions` keep their names and shapes, and now carry the grants the
  server was already enforcing.

- 7cdbcbb: fix(plugin-hono-server): surface a repeated query parameter as an array, matching the platform convention (#6878)

  **Behaviour change, not a refactor.** On the Hono server, a repeated query
  parameter — `?version=1.0.0&version=2.0.0` — used to reach your handler as the
  single string `'1.0.0'`. It now reaches it as `['1.0.0', '2.0.0']`. A
  single-valued key is unchanged: still a plain string.

  This is the ruled intent of #6878 (route 2, cli-lane seat ruling of
  2026-08-10), not an incidental cleanup.

  **Why the old behaviour was a problem.** The platform ships two `IHttpServer`
  implementations, and they answered the same request differently. The reference
  `NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array; the
  Hono adapter read `c.req.query()`, which returns only the first value per key.
  Both satisfied the declared contract — `IHttpRequest.query` is
  `Record< string, string | string[] >` — so neither had a bug, yet the
  platform's answer to "what is a repeated parameter?" depended on which server
  had booted.

  The consequence was not cosmetic. A handler cannot refuse an ambiguity it
  cannot see: #6307 found `DELETE /api/v1/packages/:id` silently narrowing a
  destructive operation's scope from a repeated `version`, and its fix (refuse
  repetition with a `400`) was unreachable on the Hono server because the
  transport had already collapsed the duplicate. Duplicates now reach the
  handler on both servers, where the rest-side gates landed in #6877 (PR #7324 —
  63 single-valued parameter slots) and #7321 (PR #7386) refuse them explicitly.

  **Both construction sites moved.** The adapter builds `IHttpRequest.query` at
  the route-handler seam _and_ inside the `use()` middleware seam; both now go
  through one `readQuery(c)` helper, so middleware and handlers agree.

  ⚠️ **If you read query parameters off the Hono server, check your assumptions.**
  A read point that assumed a string will now receive an array when — and only
  when — a client repeats that parameter. `String(req.query.x)` yields `"a,b"`
  and `Number(req.query.x)` yields `NaN` in that case. Handle the array, or
  refuse the repetition explicitly; do not reach back for the first value, which
  is the silent-wrong-answer shape #6878 set out to remove. The repo's own read
  points were swept and gated before this landed.

  Nothing in `packages/spec` changed: the declared union already permitted
  arrays. What changed is the platform's answer, from "depends on the server" to
  one answer.

  `@objectstack/http-conformance` gets the matching test tightening. Its
  cross-adapter case, added under #6878 route 1 (PR #6941) to _record_ the
  divergence, is collapsed into the single expected shape exactly as that file's
  own header instructed — plus a new middleware-seam case, so a half-applied
  change to only one of the adapter's two construction sites cannot pass. The
  single-value control case that catches an un-normalised `c.req.queries()`
  (which returns an array for every key, single-valued ones included) stays.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/observability@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- 29c6c9d: feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

  The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
  about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
  accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
  The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
  paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
  404, because **no route was ever mounted** for a declared path, so the request died at
  Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
  metadata service and called `matchEndpoint` on it — a method **no implementation in the
  repo has ever provided**. The branch returned "not handled" on every request ever served.

  So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
  mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
  `inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
  **`authRequired`**, a security semantic that parsed green and gated nothing at all. That
  is false compliance, the failure ADR-0049 exists to stop, not debt.

  ## BREAKING — a non-empty `apis:` is now rejected

  Metadata that parsed cleanly before is now **refused at publish/validate**, with the
  prescription in the rejection itself:

  ```
  apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
  so a non-empty array is rejected instead of silently accepted (#4936). …
  ```

  **FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
  accepted, and an empty array is not a special case). To actually serve the route today,
  mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
  route. That is now the only honest path, and the one `examples/app-showcase` uses
  (`src/system/server/recalc-endpoint.ts`).

  The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
  point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
  `os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
  forgot to check.

  **The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
  rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
  re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
  and stay in the spec; only _authoring them into a stack_ is refused, and only until the
  executor lands. Keep them commented next to your stack — that is what the showcase does.
  The executor (route mounting + endpoint matching + per-key wiring for
  `authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
  **#5040**, which replaces this rejection with real execution.

  ## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

  The repo carried a **second**, unrelated declaration shape for "an API endpoint":
  `ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
  `createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
  assembly site lived in `packages/core/examples/`, with no registration in
  `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
  such service. The whole family was therefore inert, including
  `ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
  that "the gateway layer automatically validates these permissions" while no gateway read
  it. Two declaration shapes, both dead; this retirement converges them on one.

  Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
  `ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
  `ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
  `ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
  `ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
  Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
  Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
  defaulted to `true` and read by nothing, configuring a service that was never composed.

  **FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
  old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
  you were building a value only your own code read — keep it as your own type. Declarative
  endpoints have one vocabulary now, `ApiEndpointSchema`.

  `ConflictResolutionStrategy` **survives** the removal and moved to
  `@objectstack/spec/api`'s `router.zod` — same name, same four values
  (`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
  independent ratchets and is not part of the retired surface.

  ## Also in this change

  - **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
    along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
    `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
    removal — but it returned `{ handled: false }` for every call it ever received, so no
    caller can observe a behaviour change beyond the missing symbol. Delete the call.
    Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
    at runtime with dead code behind it.
  - `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
    longer claims the capability is `demonstrated` — that entry read "executed by the runtime
    dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
    claim Prime Directive #10 forbids.
  - The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
    the live executor card, instead of #4936, which closes with this change.

### Minor Changes

- 2649ccb: feat(runtime,hono): 挂载 seam —— `setFallbackHandler` 实现 + 声明式端点派发步(#5040 E3, #5090)

  给声明式 `apis:` 端点铺上**唯一一条**能进入处理器的通路,并且这条通路在构造上不可能遮蔽任何
  已注册路由。执行器本身尚未落地,本次改动**零现网行为变更**:任何 stack 目前都无法发布非空
  `apis:`(publish 硬拒,直到 #5040 E7 翻转),所以这里新增的一切在真实组合里结构性不可达。

  **`@objectstack/plugin-hono-server` —— `IHttpServer.setFallbackHandler` 的实现**

  契约(#5080 落在 `@objectstack/spec/contracts`)的四条保证逐条兑现:

  - 映射到 Hono 的 `app.notFound` 钩子,**不是**通配路由。这是全部要点:通配路由要与之后注册
    的每一条路由竞争,而 Hono 按先注册者赢裁决,归属就变成插件 `start()` 顺序的函数 ——
    ADR-0076 D11 正是为此存在。兜底器只在全部显式路由未命中后运行,**零注册顺序依赖**。
  - handler 拿到的 `req.body` **可读**(与 `use()` 中间件 seam 相反,后者的契约明确不填充
    body),按 content-type 解析,与真实路由处理器走同一段代码。
  - 重复安装即**替换**,不成链。
  - handler 不写响应 → 适配器既有的未命中答案(404,或方法不匹配时 405 + `Allow`)原样保留。

  配套的一处属主收敛:404/405 应答此前由 `HonoServerPlugin.start()` 直接写在
  `getRawApp().notFound(...)` 上。`app.notFound` 是后调用者覆盖,兜底 seam 落在同一个钩子上,
  两个写入方意味着幸存者由插件启动顺序决定 —— 应答本体因此移入 `HonoHttpServer`
  (`installNotFoundSeam()` / `setFallbackHandler()` 在其中组合),一个钩子一个属主。行为
  逐字节不变(`notfound-405.test.ts` 原样通过)。

  顺带修好同一段代码上的两处不一致:适配器构造的 `IHttpRequest` 现在一律带
  `remoteAddress`(此前只有中间件 seam 有,同一个契约有两种形状);处理器**同步**抛出与
  异步 reject 现在报同一种结果(此前同步抛出会逃到 Hono 自己的错误页)。

  **`@objectstack/runtime` —— dispatcher 端点派发步**

  dispatcher-plugin 在 `start()` 中探测 `typeof server.setFallbackHandler === 'function'`
  并注册兜底器。对落在 ADR-0121 D1 保留段 `<prefix>/apps/<命名空间>/<子路径>` 下的请求,
  探测 `metadata` 服务的 `matchEndpoint`(#5089 的实现在并行开发,探测缺席即穿透):

  - **命中** → `501 NOT_IMPLEMENTED`,包络说明执行器随 17.x 落地(#5040 E4–E5 接策略键与
    执行目标);
  - **未命中 / 无 matcher / 无 metadata 服务 / 路径不在挂载前缀下** → **不写任何响应**,
    传输层既有的 404/405 答案原样成立(有回归测试逐字节钉住);
  - `matchEndpoint` 抛错按 5xx 出口应答,不降级为 404 —— 故障不得伪装成「没有这条路由」。

  派发步**不重入** `dispatch()`:那条管线会解析环境与 `executionContext`、跑匿名拒绝门、并以
  语义 404 收尾,把全部未命中请求灌进去会改变今天未命中请求的答案。裸 404 与语义 404 的收口
  是另一个决定,本次刻意不做。

  `route-ledger.ts` 新增 `* /apps/**` 登记行与 `NON_DISPATCH_MOUNT_PREFIXES`(本包在
  `dispatch()` 之外挂载的前缀),注记如实描述已接线的部分与**尚未**接线的执行部分;新增
  一致性测试钉住 ADR-0121 D1 赖以成立的事实 —— `/apps` 不属于任何内建域。

- 55dbbba: feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

  Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
  declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
  of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
  `@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
  that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
  outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
  tune did not exist (#4937). Neither half was broken; they were simply never connected, and
  both were documented as if they were.

  They are connected now, along one narrow path.

  ## What you write

  ```ts
  export default defineStack({
    manifest: {
      /* … */
    },
    server: {
      security: {
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
      },
      trustProxy: false,
    },
  });
  ```

  `server:` is a **new** top-level stack key. Nothing declared it before, so no existing
  stack changes behaviour on upgrade — there is no configuration that was inert yesterday
  and starts throttling today.

  It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
  nothing else, because those are the two keys with a consumer. It is NOT the nine-key
  `HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
  mounting them here would have made seven dead keys writable in one move (their
  enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
  budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
  is refused at `defineStack` rather than at 3am.

  **No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
  `objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
  the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
  built-in default.**

  ## What happens

  Every inbound request the server routes — REST, dispatcher, service routes, anything
  mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
  refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
  with a `Retry-After` computed from the bucket itself and the standard error envelope
  (`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

  The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
  anonymous traffic — so one abusive session cannot spend another user's budget, and
  credential-stuffing traffic (which has no principal yet) is still metered per source. That
  IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
  otherwise it is the transport's own peer address. Undeclared, those headers are attacker
  input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
  let them drain a chosen victim's.

  Counters live in the kernel `cache` service when one is registered, so a multi-node
  deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
  consume time so a cache plugin that registers later is still picked up (#4772). With no
  cache service at all it falls back to a per-process store and says so once, naming the
  consequence: the effective limit becomes the declared budget multiplied by the number of
  nodes, and nothing about the deployment looks wrong.

  ## Also in this change

  - **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
    passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
    middleware could not read the request, write a response, or decline to continue — a
    declared seam with no execution behind it, unnoticed because nothing called it. It now
    delivers method/path/query/headers plus the transport peer address
    (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
    registered before the routes it guards; the kernel's two-phase boot makes that automatic
    (`init()` before every `start()`).
  - **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
    does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
    in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
    now labelled as the reference material it always was rather than as live defaults.

  ## Explicitly NOT wired

  `ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
  **known-unwired**. Declaring them still changes nothing. They are not retired here either:
  the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
  key of a surface that may yet be implemented would only have to be undone. Tracked, not
  silent.

### Patch Changes

- dfa8bad: 修复:逃出路由 handler 的抛出不再被静默丢弃 —— 适配器接缝现在有诊断出口

  `HonoHttpServer.runHandler()` 的兜底 `.catch` 此前把 rejection 显式丢弃(参数名就是 `_err`),`wrap()` 随后回一个 `{ error: 'No response from handler' }` 的 500。净效果是:**任何**逃出 handler 的抛出,在以本适配器为 transport 的 host 上都表现为一个不带原因的裸 500,而且**任何地方都没有日志** —— 连 stack 都没有。

  现在该接缝会按 `Logger` 契约打一条 `error` 记录,带上原始 `message` / `stack` 与定位所需的请求上下文(`method` + `path`)。

  - **`Error` 走契约的 `error` 形参槽**,不塞进结构化 meta。`Error` 的 `message` / `stack` 是 non-enumerable,直接进 meta 会序列化成 `{}` —— 那比没有日志更糟,因为它会报告成功。跨 realm 的 `Error`(`instanceof` 不成立)会按 `name`/`message`/`stack` 重建;`throw 'boom'` 这类非 `Error` 抛出会被描述进 message 而不是丢掉。
  - **请求体不入日志** —— 只有 `method` 和 `path`。
  - **默认就有日志出口。** 未接线时适配器用 `createLogger()`,而不是静默:直接内嵌 `HonoHttpServer` 的 host(serverless 入口)正是本问题的生产现场,静默默认会对它们原样复现该 bug。`HonoServerPlugin.init()` 会用 `ctx.logger` 替换掉默认值;要静默须显式传 `NoopLogger`。

  新增 `HonoHttpServer.setLogger(logger)`(纯新增,不改 `IHttpServer` 契约)。

  ⚠️ **响应形状一字未改**:兜底 body 仍是 `{ error: 'No response from handler' }` + 500,已加测试钉住。把它收成声明信封会改变线上响应形状,属另一项尚未裁决的契约决策,不随本次改动附带。

- caf144a: ci(deps): OSV security batch 2026-08 — undici to 7.29.0, hono to 4.12.34,
  fast-uri to 3.1.5, so `Validate Package Dependencies` stops failing on every PR (#5032)

  Eight advisories (2 high, 6 medium) matched packages resolved in `main`'s
  `pnpm-lock.yaml`, and all eight name a fixed version:

  | advisory              | CVSS | package    | resolved         | fixed   |
  | --------------------- | ---- | ---------- | ---------------- | ------- |
  | `GHSA-7p8r-x3mc-p8w7` | 7.5  | `fast-uri` | 3.1.4            | 3.1.5   |
  | `GHSA-8j4g-w8fx-2239` | 5.3  | `hono`     | 4.12.32, 4.12.33 | 4.12.34 |
  | `GHSA-4cwx-7wf7-3272` | 7.4  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-jr45-8vmc-qm54` | 5.9  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-8xcm-r25x-g524` | 4.8  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-v3r7-h72x-cjcm` | 4.8  | `undici`   | 7.28.0           | 7.29.0  |
  | `GHSA-m8rv-5g2x-5cg5` | 4.2  | `undici`   | 7.28.0           | 7.29.0  |

  The OSV-Scanner step in `.github/workflows/validate-deps.yml` reads
  `pnpm-lock.yaml` directly and exits non-zero on any match, so the job was red on
  `main` itself and attached that red to every PR touching a manifest or the
  lockfile, whatever the PR contained (observed on #5027, whose own lockfile delta
  is three lines and resolves no new package). A permanently red gate is worse
  than no gate: the next PR that really does introduce a vulnerable dependency
  looks exactly like all the others.

  `undici` repeats the trap #4945 taught. The existing pin
  (`undici@>=7.23.0 <7.28.0: ^7.28.0`, added for `GHSA-vmh5-mc38-953g`) had
  settled on 7.28.0 — the version these five advisories affect — and its exclusive
  upper bound no longer covered it, so the override sat there doing nothing.
  Selector and target move together, to `<7.29.0` / `^7.29.0`. Transitive-only via
  `@vscode/vsce` > `cheerio`; `@ai-sdk/provider-utils` already resolved 7.29.0, so
  the two dedupe onto one copy. `jsdom`'s `undici` 8.9.0 is outside the selector
  and untouched.

  `fast-uri` is transitive-only through `ajv@8.20.0` (declares `^3.0.1`), reaching
  `@modelcontextprotocol/sdk`, `@objectstack/objectql`, `secretlint` and `table`;
  a `fast-uri@<3.1.5: ^3.1.5` override covers all of them.

  `hono` is the one that is not transitive-only, which is why this changeset
  releases something. Two versions were resolved: 4.12.32 from our own packages
  and 4.12.33 pulled by `@modelcontextprotocol/sdk`. The override moves the
  transitive copy and the declared ranges move with it — `@objectstack/plugin-hono-server`
  `dependencies.hono` to `^4.12.34` (the published-manifest change this patch
  covers), plus the `@objectstack/hono` and `@objectstack/plugin-auth`
  devDependencies. Overrides do not ship with published packages, so a declared
  range left behind would mean downstream resolves a version CI never ran —
  exactly what `scripts/check-override-consistency.mjs` exists to catch. The
  `@objectstack/hono` **peer** range stays the permissive `^4.12.8` on purpose: a
  peer states which host `hono` the adapter works against, and a host that pins an
  old one owns that copy. After the bump the workspace resolves a single
  `hono@4.12.34`.

  Scope is the eight advisories #5032 lists and nothing else. #4965 (advisories
  with no fix available, and the `osv-scanner.toml` exemption conventions that
  answer them) is a separate question — every advisory here has a fix, so this is
  an upgrade, not an exemption.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- e5a4d26: feat(plugin-hono-server)!: delete the CRUD/discovery convenience surface and the `registerStandardEndpoints` flag — the plugin is a transport adapter (#4073)

  Completes the retirement. `HonoServerPlugin` now owns the socket, the middleware
  and the three current-user endpoints, and nothing else. The data and discovery
  APIs have one owner each: `@objectstack/rest` and the runtime dispatcher
  (ADR-0076 D11).

  **Removed**

  - `POST/GET /api/v1/data/:object` and `GET /api/v1/data/:object/:id` — the raw
    C+R surface that delegated straight to ObjectQL.
  - `GET /api/v1/discovery` and `GET /.well-known/objectstack` — this plugin's
    third discovery payload, which predated `DiscoverySchema` and could not
    satisfy it (no `services`, the ADR-0076 D12 source of truth).
  - The `registerStandardEndpoints` option. It is gone, not defaulted off: passing
    it is now a type error, and passing it via `as never` mounts nothing.

  **Unaffected**

  - `/auth/me/permissions`, `/auth/me/localization` and `/me/apps` — this plugin
    is the platform's only supply and they register unconditionally (#4144).
  - Every composed host: `os serve`, `objectstack dev`, cloud's objectos and every
    documented composition mount REST and/or the dispatcher, which already served
    these routes and answered byte-identically with the flag on or off (#4260).

  **Migration** — only a host that mounts `HonoServerPlugin` with neither owner is
  affected. It now has no data or discovery API, and the boot warns once naming
  both remedies. Mount `createRestApiPlugin` from `@objectstack/rest` for full
  CRUD behind the gate stack, or `createDispatcherPlugin` from
  `@objectstack/runtime`. There is no flag to opt back in.

  **Why** — the surface was duplicate and lesser supply (C+R only, a subset of the
  gates, a non-conforming discovery payload), and it charged rent: #2567, #3298
  and #4018 each had to re-implement a platform invariant on it after the fact,
  because a second implementation of a route is a second place every future
  invariant must be remembered.

### Minor Changes

- 545d931: fix(plugin-hono-server): the current-user endpoints answer from the kernel that OWNS the request (cloud#927)

  `/api/v1/auth/me/permissions`, `/auth/me/localization` and `/me/apps` resolved
  their answer from the service locator captured at REGISTRATION time. On a
  single-environment host that is the only kernel, so it is right. On a
  **multi-tenant** host it is the routing shell — and identity is not there.
  cloud's `ArtifactKernelFactory` mounts `AuthPlugin` per environment, and its host
  kernel deliberately has none ("AuthPlugin is intentionally NOT injected on the
  host"), so `getService('auth')` threw, the session resolver fell to its catch, and
  every authenticated tenant caller got `{authenticated:false}`.

  That is worse than an error: objectui's `MePermissionsProvider` reads
  `authenticated:false` as ANONYMOUS and keeps its permissive default
  (`return data.authenticated !== true`), because a guest surface has no resolvable
  permissions by design. So the console's FLS / `apiOperations` hints were
  systematically wrong — not a bypass (the server still enforces per request), but
  exactly the client/server divergence `foldWildcardSuperUser` and
  `clampManagedObjectWrites` exist to close, one layer up.

  These endpoints now consult the host's ADR-0006 **`kernel-resolver`** seam per
  request — the same seam the runtime dispatcher has used since Phase 5, so
  multi-tenant routing has one strategy rather than two:

  - **No `kernel-resolver` registered** → unchanged. Single-environment hosts,
    `os serve`, and the QA conformance host see no difference.
  - **A kernel** → that kernel's `auth` / `objectql` / `metadata` /
    `security.permissions` answer.
  - **`undefined`** → the registration-time locator, which is the seam's contract
    for an unscoped / control-plane request.
  - **A throw** → no answer at all: the thrown status when it carries one (cloud's
    `KernelWarmingError` is 503 + `Retry-After`), else 503
    `environment_unavailable`. Falling back to the default kernel would hand back a
    confidently-wrong `{authenticated:false}` that the client fails OPEN on.

  The seam is read **lazily, per request**, never captured at registration — a host
  may register these routes before `kernel.bootstrap()` (to outrank an
  `/api/v1/auth/*` wildcard), which is before the plugin that registers the
  resolver has run its `init()`.

  **FROM → TO for host adapters.** `CurrentUserEndpointsContext` gains an optional
  `getKernel(): unknown`, the `defaultKernel` argument the seam takes. A
  `PluginContext` already satisfies it, so hosts that mount `HonoServerPlugin` need
  no change. A host passing a hand-rolled locator to
  `registerCurrentUserEndpoints` should add it:

  ```diff
   registerCurrentUserEndpoints({
     rawApp: httpServer.getRawApp(),
  -  ctx: { getService: (n) => kernel.getService(n) },
  +  ctx: { getService: (n) => kernel.getService(n), getKernel: () => kernel },
   });
  ```

  Without it a multi-tenant host cannot be asked which kernel owns the request and
  keeps the old provenance — a silent downgrade, so it is worth adding even where
  the host is single-environment today.

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- d4720ca: feat(plugin-hono-server): export `registerCurrentUserEndpoints` so a host without the plugin can still supply them (cloud#924)

  `GET /api/v1/auth/me/permissions`, `/api/v1/auth/me/localization` and
  `/api/v1/me/apps` are the platform's **sole** supply — neither
  `@objectstack/rest` nor `@objectstack/runtime` registers any `/me/*` route, the
  objectui console reads the first for its whole permission layer and the second
  for regional defaults, and `core`'s auth gate allow-lists the last two as
  endpoints a gated user MUST still reach. #4073/#4079 freed them from the
  `registerStandardEndpoints` flag, but left the supply welded to
  `HonoServerPlugin`: a host that stands up a bare `HonoHttpServer` and registers
  it as `http.server` itself — rather than mounting the plugin — got no provider at
  all, and the console's FLS / `apiOperations` had no server-side answer on that
  startup path.

  Registration needs a Hono app and a service locator, not ownership of the
  listening socket, so it is now a standalone module (`./current-user-endpoints`)
  that both shapes call:

  ```ts
  import { registerCurrentUserEndpoints } from "@objectstack/plugin-hono-server";

  const httpServer = new HonoHttpServer();
  kernel.registerService("http.server", httpServer);
  registerCurrentUserEndpoints({
    rawApp: httpServer.getRawApp(),
    // any { getService, logger } — a PluginContext satisfies it structurally
    ctx: {
      getService: (n) => {
        try {
          return kernel.getService(n);
        } catch {
          return undefined;
        }
      },
    },
  });
  ```

  It is **idempotent**: it returns `false` and registers nothing when all three
  paths are already served, so a host may both call it eagerly on the raw app AND
  mount the plugin — the plugin's `kernel:ready` registration then no-ops instead
  of shadowing the host's routes with dead duplicates. Registering early matters,
  because Hono's only route precedence is first-registration-wins and plugin-auth
  mounts a `/api/v1/auth/*` wildcard that `/auth/me/*` must outrank.

  **No behaviour change for existing hosts.** `os serve` and every host that mounts
  `HonoServerPlugin` register the same three routes, in the same `kernel:ready`
  position, with the same response shapes — the plugin now delegates to the shared
  registrar instead of owning a private method.

  **Moved exports (same package, same names, no rename).** `foldWildcardSuperUser`,
  `clampManagedObjectWrites`, `seedSuperUserRestrictedObjects`,
  `annotateEffectiveApiOperations`, `ManagedSchemaLike` and `ApiExposureSchemaLike`
  now live in `./current-user-endpoints` alongside the endpoint they shape. Importing
  them from the package root (`@objectstack/plugin-hono-server`) is unchanged; only a
  deep import of `.../dist/hono-plugin` would need updating, and the package exposes
  no such subpath.

- 43ff598: fix(plugin-hono-server): stop gating the current-user endpoints behind `registerStandardEndpoints` (#4073)

  `registerStandardEndpoints` gated two unrelated things behind one flag:

  - **Duplicate supply** — raw `POST/GET /api/v1/data/:object` (create + read
    only), which `@objectstack/rest` also serves and, registering first, is what
    actually answers; plus `GET /api/v1/discovery` and
    `/.well-known/objectstack`, which the dispatcher and REST own and which this
    surface already cedes to them (#4018).
  - **Sole supply** — `GET /api/v1/auth/me/permissions`,
    `/api/v1/auth/me/localization` and `/api/v1/me/apps`. Nothing else in the
    platform mounts these: neither `@objectstack/rest` nor `@objectstack/runtime`
    registers any `/me/*` route, the console's entire permission layer reads
    `/auth/me/permissions`, the console reads `/auth/me/localization` for regional
    defaults, and `core`'s auth gate allow-lists `/me/apps` + `/me/localization`
    as endpoints a gated user MUST still reach to bootstrap the remediation UI.

  `os serve` gets all of it only because the flag defaults to `true` — the CLI
  constructs `new HonoServerPlugin({ port })`. So `registerStandardEndpoints:
false`, whose documented job is the optional CRUD/discovery convenience surface,
  silently took the console's permissions and localization down with it.

  The three current-user endpoints now register **unconditionally**, and the flag
  covers the duplicate half only — what its name and docs always claimed.

  **FROM → TO.** If you set `registerStandardEndpoints: false` and worked around
  the missing endpoints (proxying `/auth/me/permissions` yourself, or pinning the
  flag to `true` purely to keep them), you can drop that workaround: the endpoints
  are now present either way. No route is removed and no response shape changes,
  so a host that left the flag at its default sees no difference. If you relied on
  `false` meaning "this plugin mounts no `/api/v1` routes at all", that is no
  longer true — it never was for `os serve`, which is the only host that shipped
  the flag's default.

  Also removes three unreferenced `*_ENDPOINT_PRIORITY` constants;
  `DISCOVERY_ENDPOINT_PRIORITY = 900` in particular implied a route-priority
  mechanism that does not exist (precedence here is Hono's
  first-registration-wins).

- 623e555: feat(plugin-hono-server): `registerStandardEndpoints` now defaults to `false` — the deprecated CRUD/discovery convenience surface is opt-in (#4073)

  The flag mounts raw C+R `/api/v1/data/:object` and `/api/v1/discovery` /
  `/.well-known/objectstack`. Every path it mounts is duplicate — and lesser —
  supply: C+R only, a subset of the gates, a pre-`DiscoverySchema` discovery
  payload. `@objectstack/rest` serves full `/data` CRUD behind the whole gate
  stack, REST/the dispatcher own discovery (#4018 cede), and #4260 pinned that a
  composed host answers **byte-identically** with the flag on or off. The surface
  has also been a standing tax: #2567, #3298 and #4018 each had to re-implement a
  platform invariant here after the fact.

  **FROM → TO**

  - **Composed hosts (REST and/or the dispatcher mounted)** — `os serve`,
    `objectstack dev`, cloud's objectos, every documented path: **no change**.
    Those plugins already answer every route this surface covered, and answered
    them first.
  - **Bare hosts (HonoServerPlugin only)**: `/api/v1/data/:object`,
    `/api/v1/discovery` and `/.well-known/objectstack` are **no longer mounted by
    default**. The boot now logs a warn naming the flag and the remedy instead of
    leaving a silent 404. Migrate by mounting `createRestApiPlugin` from
    `@objectstack/rest` — it needs the same `objectql` service this surface
    already required, and returns full CRUD plus the gate stack — or pass
    `registerStandardEndpoints: true` to keep the legacy surface during the
    deprecation window.
  - The current-user endpoints (`/auth/me/permissions`, `/auth/me/localization`,
    `/me/apps`) are **unaffected** — they never sat behind this flag (#4144) and
    register unconditionally.

  The flag is now marked `@deprecated`. Next step per #4073: one release of
  observation, then `registerDiscoveryAndCrudEndpoints` (and the flag) are deleted
  and this plugin becomes a pure transport adapter (ADR-0076 D11).

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 4dc14cc: Retire the three `security.*` dev stubs, and refuse to load `plugin-dev` under `NODE_ENV=production` (#4093).

  **The security stubs are gone.** When `@objectstack/plugin-security` was not installed, `plugin-dev` filled its three slots with fakes that inverted the decision each stood in for: `security.permissions.checkObjectPermission()` returned `true` for everything, `security.rls.compileFilter()` returned `null` so no row-level predicate was applied, and `security.fieldMasker.maskResults()` returned rows unmasked. ADR-0076 D12's rule — learned from the analytics shim it retired in #3891 — is that a fallback may degrade features, **never security semantics**; `packages/spec/src/contracts/security-service.ts` says the same from the other side (these three are plugin-security's internals, and access-narrowing answers must fail CLOSED). Since `plugin-dev` loads SecurityPlugin through the same optional dynamic import as everything else, the package merely being absent was enough to swap real RBAC/RLS/masking for allow-all behind a single `warn` line.

  The slots now stay empty — which is what production has without SecurityPlugin, and what every consumer already handles — and the boot log states plainly that RBAC, row-level security and field masking are not being enforced.

  **`plugin-dev` now refuses to initialize under `NODE_ENV=production`.** It is a published package that registers development fakes for every unclaimed core service slot, including ones that report success for work they never did, and it had no environment check of its own: an `objectstack.config.ts` carrying `new DevPlugin()` into a production deploy got the whole fake slate with only a boot log to say so. `init()` now throws there. Set `OS_ALLOW_DEV_PLUGIN=1` if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

  FROM → TO: a stack that relied on the dev security stubs was not being protected by them — it was being told everything was allowed. Install `@objectstack/plugin-security` to enforce RBAC/RLS/masking, or accept the empty slots (unchanged behaviour on every path that already handled an absent SecurityPlugin). A production process that loaded `plugin-dev` must now either drop it and install the real services, or opt in explicitly with `OS_ALLOW_DEV_PLUGIN=1`.

  Also: `plugin-hono-server`'s `/auth/me/permissions` resolves `security.permissions` and `metadata` through the same guarded lookup its three sibling lookups already used. An unregistered slot makes `getService` throw, which previously landed in the outer catch — the same fail-open response body, but logged as "/auth/me/permissions failed" on every console navigation instead of taking the deliberate `!evaluator` branch.

- 839982e: fix(plugin-hono-server): compute the standalone discovery `routes` from real registrations, and cede to the real owner (#4018)

  `registerStandardEndpoints` served a **fully static** discovery: a hardcoded
  `routes` table listing `auth` / `packages` / `analytics` / `workflow` /
  `automation` / `ai` / `notifications` / `i18n` / `storage` / `ui` regardless of
  what the host actually mounted. A standalone Hono deployment therefore
  advertised ten route families and 404'd on every one no plugin bridged — the
  "advertise a route that doesn't exist" class ADR-0076 D12 exists to kill, and
  the reason this surface disagreed with the two real discovery builders
  (`HttpDispatcher.getDiscoveryInfo`, `metadata-protocol`'s `getDiscovery`), which
  both compute per service at runtime.

  Two changes, no new discovery implementation to keep in sync:

  - **Single owner (D11 / OQ#9).** When `@objectstack/rest` or the runtime
    dispatcher is on the kernel, this surface no longer registers
    `${prefix}/discovery` — that plugin owns it. Both register during plugin
    `start()`, i.e. before this `kernel:ready` hook, and Hono is
    first-registration-wins, so they already shadowed this handler in every
    composed deployment: the cede changes no served payload, it removes a third
    one nobody read. `/.well-known/objectstack` is ceded to the dispatcher only
    (REST never registers it), so a REST-without-dispatcher host keeps the
    redirect.

  - **Computed, not hardcoded (D12).** When this surface does own `/discovery`,
    `routes` is derived per request from the app's live route table: a family is
    advertised iff a route is really registered at or under its base path. A
    wildcard mounted _above_ the base (global `/*` middleware, `/api/v1/*`) does
    not count as a mount.

  **What changes for you.** On a standalone `HonoServerPlugin` host (no REST, no
  dispatcher), `GET /api/v1/discovery` now omits every family nothing mounts —
  most visibly `routes.metadata`, since `/api/v1/meta` ships with
  `@objectstack/rest` / the dispatcher. Clients that read a route out of
  discovery and call it stop getting a 404; `@objectstack/client` falls back to
  the conventional path for any omitted key, so `client.connect()` is unaffected.
  Composed deployments (`os serve`, cloud) are unchanged — the dispatcher's
  service-aware discovery was already the one being served.

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

- 2053714: fix(hono,plugin-hono-server,runtime): one CORS source and one registry key — the last derivable copies from the #3786 sweep

  Re-ran the sweep across all 72 packages. The earlier pass globbed `packages/*/src`,
  which is one level deep, so it missed everything under `packages/plugins/` and
  `packages/adapters/` — the "sweep is basically clean" report was based on an
  incomplete scan.

  **A stale CORS default, on the one description callers actually read.**
  `HonoCorsOptions.allowHeaders`' TSDoc promised
  `['Content-Type', 'Authorization', 'X-Requested-With']` "which is sufficient for
  cookie and bearer-token auth". The real default carries three more:
  `X-Tenant-ID` and `X-Environment-Id` (multi-tenant routing) and `If-Match` (the
  OCC token on record PATCHes, objectui#2572). Sizing a custom `allowHeaders`
  against that sentence drops all three and every cross-origin save fails with
  "Failed to fetch".

  The instructive part: **three** Hono CORS sites each carried their own copy of
  the defaults under "keep in sync" comments, and the copies all agreed. What
  drifted was the _doc_ — the only description with no counterpart to be diffed
  against, and the only one a caller reads.

  Both defaults are now single constants, `DEFAULT_CORS_ALLOW_HEADERS` and
  `DEFAULT_CORS_EXPOSE_HEADERS`, exported from `@objectstack/plugin-hono-server`
  and imported by the adapter (which already depends on it — no new edge). The
  TSDoc links them rather than restating, and documents an asymmetry it never
  mentioned: `allowHeaders` REPLACES the default, `exposeHeaders` MERGES with it.

  `hono-plugin.test.ts` stopped stubbing `./adapter` wholesale and keeps the real
  constants via `importOriginal` — it asserts exact header lists, so a mocked copy
  would make the test agree with itself rather than with what ships. Verified:
  removing `If-Match` from the constant fails `should allow If-Match by default`,
  by name.

  **A third copy, in the public protocol docs.** `content/docs/protocol/kernel/
http-protocol.mdx` advertised `Access-Control-Allow-Headers: Authorization,
Content-Type` — two of the six — and methods missing `PUT` and `HEAD`, with no
  mention of the exposed headers at all. That is the copy an integrator builds a
  client against: reading it, you would not know `If-Match` is permitted (so you
  would not attempt OCC) or that `set-auth-token` is readable (so a rotated
  session would look like a bug). Corrected, with the three non-obvious allowed
  headers and the two exposed ones explained, and a pointer to the constants as
  the source of truth.

  **A hand-copied service-registry key.** `runtime`'s share-links domain resolved
  `'shareLinks'` as a string literal, copied from `SHARE_LINK_SERVICE` — whose own
  doc-comment says "keep in sync with the SharingPlugin registration". It now
  imports the constant. A drifted copy resolves nothing, so every share link
  answers 501 "Sharing is not configured for this environment" on an environment
  where it is configured perfectly well.

  **Plus a duplicate ledger entry**, which is the same defect one level up:
  `check-generated.ts` carried two `NO_GENERATOR` entries for
  `check:strictness-ledger`, because #4203 and #4252 each added one without seeing
  the other. Functionally harmless (the ledger is read into a `Set`) but it leaves
  two comments telling overlapping versions of the same story. #4203's is kept —
  it is the more complete account and it is the PR that fixed the underlying
  problem.

  Checked and deliberately left alone: `ApprovalStatus` (5 values) and
  `ApprovalActionKind` (12 values) versus their `plugin-approvals` selects — diffed
  verbatim, no drift today, still hand-copied across a package boundary.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

- d8c4957: feat: user-level export permission axis (#3544, #3391 follow-up)

  `export` is a user-gated operation, not just "anyone who can list". A permission
  set can now deny export on an object while keeping read — matching Salesforce
  "Export Reports" / Dynamics "Export to Excel" / NetSuite "Export Lists" / SAP
  S_GUI 61.

  - **spec** `ObjectPermissionSchema` gains an optional `allowExport` bit. It is
    deliberately OPTIONAL with **no default** so it is a backward-compatible
    opt-out: unset → inherits read (today's "can-list ⇒ can-export"), `false` →
    export denied while read is kept, `true` → granted.
  - **plugin-hono-server** `annotateEffectiveApiOperations` derives
    `userExportAllowed = allowExport !== false` from the resolved per-object
    permission and threads it into `resolveEffectiveApiMethods` — so `export`
    derives from `list ∧ userExportAllowed`. When the axis removes `export` from
    an otherwise-open object, the object is now annotated (the effective set minus
    `export`) so the client hides the Export button; an unrestricted object with
    export still allowed stays unannotated (client default-allow).

  Wires the `userExportAllowed` slot reserved in #3391 P1 — zero contract change
  to the derivation table or the frontend (it already consumes the effective
  `apiOperations`). Backward-compatible: existing permission sets (no
  `allowExport`) keep today's behavior everywhere.

### Patch Changes

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
  production-dependency batch from #3517

  **better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
  `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
  adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
  1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
  `scimProvider` model and the generate-token endpoint are gone), which is a
  feature migration, not a version bump. Its peer range accepts rc.2 core, and the
  advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

  **BREAKING — account identity.** better-auth renamed `account.accountId` to
  `account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
  resolves accounts by `(issuer, providerAccountId)`.

  - FROM `fields: { accountId: 'account_id' }` → TO
    `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
    account id keeps its `account_id` column — only the better-auth-side name
    moved — and `sys_account` gains an `issuer` column.
  - FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
    `createAccount({ providerId, issuer, providerAccountId, … })`. A local
    password account carries the issuer better-auth mints for itself,
    `local:credential`.
  - FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
    `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
    from `accounts.list()`), matching better-auth's narrowed body.
    `accounts.list()` returns `issuer` + `providerAccountId` in place of
    `accountId`.

  **Existing deployments:** rows written before 1.7 have no issuer and are
  invisible to sign-in until stamped. The auth plugin now runs an idempotent
  boot-time backfill that stamps what it can derive — `local:credential` for
  password accounts, `local:oauth:<providerId>` for configured social providers,
  and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
  Accounts from a federated IdP that is no longer registered cannot be derived;
  they are logged with their provider id and row count rather than guessed, and
  those users cannot sign in through that provider until the row is stamped with
  the IdP's issuer or removed so a fresh login re-links it.

  **Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
  now implemented over the kernel cache service — `getAndDelete` (single-use
  verification values) and `increment` (fixed-window rate-limit counter;
  `rateLimit.storage: 'secondary-storage'` throws at boot without it).

  The rest of #3517's production-dependency batch rides along: `@oclif/core`
  4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
  `pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.

- c2d9098: feat(rest/protocol): extend droppedFields write-observability to the bulk paths + client SDK (#3455)

  Follow-up to #3448 (#3431 D2): the single-write PATCH/POST `/data` paths already
  surface LEGALLY-stripped write fields (static `readonly` #2948 / `readonlyWhen`
  #3042 / #3043 create ingress) as `droppedFields`. The **bulk** write paths did
  not — the same strips happened silently on every batched row — and the typed
  client warning + CORS mirror were deferred. This closes those out.

  **Bulk passthrough (metadata-protocol).**

  - `updateManyData` and `batchData` (update/upsert rows) now register a per-row
    `onFieldsDropped` collector and attach the events to that row's result.
  - `createManyData` diffs each supplied row against its #3043-stripped form and
    returns an **aggregated** top-level `droppedFields` (one event per
    object/reason with the union of field names) — its `{ records, count }`
    response has no per-row slot, and the insert-time strip is static-`readonly`
    only, so it is schema-uniform across rows and the aggregate is faithful.
  - `insertManyData` keeps per-row precision, attaching `droppedFields` to each
    outcome.
  - **Correctness fix bundled in:** `updateManyData` and `batchData` never threaded
    the caller's execution `context` to the engine — bulk writes ran context-less,
    so RLS/FLS and `readonlyWhen` evaluated without the caller's principal, and the
    batch create-ingress strip was hard-coded to a non-system context. All engine
    calls in both methods now run under the resolved `context`.

  **Contract (spec).** `BatchOperationResultSchema` gains an optional per-row
  `droppedFields` (covers `updateMany` + `batch`, which alias
  `BatchUpdateResponseSchema`); `CreateManyDataResponseSchema` gains the optional
  aggregated `droppedFields`. Both are omit-when-empty, so existing clients are
  unaffected. `X-ObjectStack-Dropped-Fields` is deliberately **not** emitted for
  batches — one response header cannot express per-row drops, so the per-row body
  field is the canonical bulk channel.

  **Typed client warnings (@objectstack/client).** `CreateDataResult` /
  `UpdateDataResult` gain `droppedFields?: DroppedFieldsEvent[]`, giving the body
  channel a type instead of an untyped property.

  **CORS (@objectstack/hono, @objectstack/plugin-hono-server).**
  `x-objectstack-dropped-fields` is added to the default `Access-Control-Expose-Headers`
  allow-list (kept in lockstep across both Hono CORS sites) so a cross-origin
  browser can read the single-write drop header. The body `droppedFields` remains
  the primary, cross-origin-safe surface — this is a convenience mirror.

  **GraphQL — not applicable (documented).** #3455 lists a GraphQL mutation item,
  but GraphQL has no runtime: `kernel.graphql` is unassigned everywhere and
  `handleGraphQL` returns `501`, and discovery never advertises `/graphql`. There
  is no schema generator or mutation resolver to expose a typed payload field on,
  so there is nothing to wire until a GraphQL engine lands — at which point the
  protocol-layer `droppedFields` is already present and only the GraphQL schema
  projection would remain.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/observability@17.0.0-rc.0

## 16.1.0

### Patch Changes

- 818e6a3: fix(server-timing): emit the per-request, admin-gated `Server-Timing` header on the standard server (`os serve`/`dev`) (#3361)

  The per-request `Server-Timing` path (#2408) — where an admin sends
  `X-OS-Debug-Timing: 1` (or `json`) and gets phase timings while an ordinary user
  gets nothing — never emitted on the shipped Hono server. The disclosure gate the
  Hono middleware opens is only ever flipped by the runtime dispatcher's
  `timedResolveExecutionContext`, but the data (`/api/v1/data/*`) and metadata
  (`/api/v1/meta/*`) routes on `os serve`/`dev` are served by `@objectstack/rest`'s
  `RestServer` (which shadows the Hono plugin's own CRUD), and its identity
  resolver never opened the gate. Only global mode (`OS_SERVER_TIMING=true`) — which
  discloses to _every_ caller, not just admins — worked.

  - **observability**: the disclosure predicate `isPerfDisclosurePrincipal(ec)` now
    lives here (the home of the gate), the single definition of "who may pull
    per-request timings" shared by every HTTP entry point. `@objectstack/runtime`
    re-exports it for back-compat.
  - **rest**: `RestServer.resolveExecCtx` opens the gate for an admin/service
    principal (via the carried `posture` rung), the REST-server analog of the
    dispatcher — this is the fix that makes `os serve`/`dev` emit.
  - **plugin-hono-server**: the standalone CRUD surface's self-contained
    `resolveCtx` opens the gate too (deriving the rung for the gate decision only,
    never writing it onto the enforcement context). Adds an e2e test that boots the
    Hono app and asserts an admin gets `Server-Timing` while a member/anon does not.

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

- 2049b6a: feat(observability): admin-gated per-request `Server-Timing` via `X-OS-Debug-Timing` (#2408)

  Perf-tuning mode was previously global-only (`serverTiming` option /
  `OS_SERVER_TIMING`), which discloses internal phase durations — a mild
  backend-fingerprinting surface — to every caller. This adds the per-request
  gating path from the design so an operator can pull a single request's
  `Server-Timing` breakdown on a live environment without turning the header on
  for everyone.

  - **observability**: a request-scoped disclosure gate (`runWithPerfDisclosure`,
    `allowPerfDisclosure`, `isPerfDisclosureAllowed`, `PerfDisclosureGate`) kept
    separate from the pure `PerfTiming` collector and pinned to its own
    `Symbol.for` store so the middleware and dispatcher share it across module
    copies.
  - **plugin-hono-server**: the Server-Timing middleware is registered by default
    (unless `serverTiming: false`). It runs the collector when timing is global
    **or** the request sends `X-OS-Debug-Timing: 1`, and emits the header only
    when the gate is open. `OS_PERF_TIMING=1` now also enables global mode.
  - **runtime**: after resolving the execution context, the dispatcher opens the
    gate for admin/service/system principals, so ordinary callers never receive
    the header even if they send the debug header.

  Existing global-mode behavior is unchanged.

### Patch Changes

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/observability@16.0.0

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/observability@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

- 2049b6a: feat(observability): admin-gated per-request `Server-Timing` via `X-OS-Debug-Timing` (#2408)

  Perf-tuning mode was previously global-only (`serverTiming` option /
  `OS_SERVER_TIMING`), which discloses internal phase durations — a mild
  backend-fingerprinting surface — to every caller. This adds the per-request
  gating path from the design so an operator can pull a single request's
  `Server-Timing` breakdown on a live environment without turning the header on
  for everyone.

  - **observability**: a request-scoped disclosure gate (`runWithPerfDisclosure`,
    `allowPerfDisclosure`, `isPerfDisclosureAllowed`, `PerfDisclosureGate`) kept
    separate from the pure `PerfTiming` collector and pinned to its own
    `Symbol.for` store so the middleware and dispatcher share it across module
    copies.
  - **plugin-hono-server**: the Server-Timing middleware is registered by default
    (unless `serverTiming: false`). It runs the collector when timing is global
    **or** the request sends `X-OS-Debug-Timing: 1`, and emits the header only
    when the gate is open. `OS_PERF_TIMING=1` now also enables global mode.
  - **runtime**: after resolving the execution context, the dispatcher opens the
    gate for admin/service/system principals, so ordinary callers never receive
    the header even if they send the debug header.

  Existing global-mode behavior is unchanged.

### Patch Changes

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/observability@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/observability@15.1.1

## 15.1.0

### Minor Changes

- f531a26: fix(security): enforce the anonymous-deny posture uniformly across HTTP surfaces (#2567)

  The ADR-0056 D2 `requireAuth` flip made REST `/data/*` deny-anonymous by
  default, but three sibling surfaces reached ObjectQL without passing through the
  gate — so the platform's anonymous posture was **inconsistent by surface**: an
  anonymous caller denied on `/data` could read the same object data through a
  different door. This closes the remaining two gaps (the `/meta` gate had already
  landed) and pins every surface with a conformance row.

  - **Dispatcher GraphQL** (`runtime/http-dispatcher.ts`, `dispatcher-plugin.ts`):
    `POST /graphql` reached `kernel.graphql`, whose security middleware falls
    **open** for an anonymous context. `handleGraphQL` now applies the same
    `requireAuth` gate as `/data` and `/meta`, resolving identity for the direct
    route that does not flow through `dispatch()`. The dispatcher's `requireAuth`
    default is aligned with the REST plugin's (`?? true`) so a bare host no longer
    denies anonymous `/data` while serving the same rows over `/graphql`; an
    explicit `requireAuth: false` opt-out is honoured and logs a boot warning.

  - **Raw-hono standard `/data` routes** (`plugin-hono-server/hono-plugin.ts`):
    these delegate straight to ObjectQL and were only _shadowed_ when the REST
    plugin registered the same paths first — so secure-by-default depended on
    plugin registration order. Each route now consults `requireAuth` (secure by
    default, mirroring `rest-server.ts`), making the deny decision a property of
    this entry point too. Order no longer affects the anonymous posture.

  **Behaviour change:** on a `requireAuth` deployment (the secure default),
  anonymous `POST /graphql` and anonymous raw-hono `/data` now return 401.
  Deployments that intentionally serve these surfaces publicly set
  `requireAuth: false` (a boot warning is logged). Proven end-to-end on the
  platform default in `showcase-anonymous-deny-surfaces.dogfood.test.ts`, with
  handler-level regression coverage in `http-dispatcher.requireauth.test.ts` and
  `hono-anonymous-deny.test.ts`, and pinned by three new authz-conformance rows.

### Patch Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: refactor(security): converge the anonymous-deny decision into one shared function + a source-enumerating ratchet (#2567 Phase 2)

  Phase 1 gated every HTTP surface (REST `/data`, dispatcher `/graphql` + `/meta`,
  raw-hono `/data`) against the secure-by-default `requireAuth` posture, but each
  seam hand-rolled the same `!userId && !isSystem → 401` check. Phase 2 removes
  that duplication and pins the surfaces so a new ungated entry point fails CI.

  - **New `shouldDenyAnonymous` in `@objectstack/core`** (`security/anonymous-deny.ts`)
    — the single anonymous-deny decision + shared 401 body/constants, mirroring the
    `auth-gate.ts` pattern (pure function so the seams can never drift). All five
    seams — REST `enforceAuth`, dispatcher `handleGraphQL` / `handleMetadata` /
    `handleAI`, hono `denyAnonymous` — now delegate to it. **Pure refactor: no
    runtime behavior change** (verified by the unchanged Phase-1 handler + e2e
    proofs). Identity resolution and the dynamic exemptions (public-form grants,
    share-link tokens) are untouched — they run upstream and only ever hand the
    seam an already-resolved context.
  - **A `discover()` ratchet on the authz-conformance matrix** — it statically
    enumerates the data/meta/graphql HTTP entry points from source (curated
    per-file probes, control-plane routes excluded) and asserts each is classified
    by a matrix `covers` key. A new `/data`/`/meta`/`/graphql` route (or a
    removed/stale `covers`) now fails CI as UNCLASSIFIED / STALE, not in review. A
    companion negative test proves the ratchet bites.

  A design trap is guarded: `isAuthGateAllowlisted(undefined)` returns `true`, so a
  body-routed seam (GraphQL, which has no request path) must pass no path — the
  shared function's non-empty-path guard denies anonymous unconditionally there,
  never falling through to the control-plane allowlist.

- f531a26: CORS default `allowHeaders` now includes `If-Match`. The REST record update
  accepts the OCC token as an `If-Match` header (objectui's record-level inline
  edit sends it on every save), but the preflight allow-list omitted it — so on
  any split-origin deployment (console dev server against a backend on another
  origin) the browser failed the preflight and every inline-edit save died with
  "Failed to fetch". Found live while dogfooding objectui#2572; same
  split-origin failure class as the #2548 Bearer fixes. Explicit user-supplied
  `allowHeaders` still win unchanged.
- 627f225: feat(spec): userActions.edit/delete accept per-record CEL predicates (objectui#2614)

  `userActions.edit` / `userActions.delete` now accept, in addition to the
  plain boolean, an object form `{ enabled?, visibleWhen?, disabledWhen? }`
  (`RowCrudActionOverrideSchema`) so the built-in row Edit/Delete affordances
  can be hidden or disabled **per record** via CEL predicates — the same
  evaluation contract custom row actions already use. `visibleWhen` false →
  button not rendered (fail-closed); `disabledWhen` true → rendered disabled
  (fail-soft). Advisory UI gating only; server enforcement stays with
  permissions/hooks.

  `resolveCrudAffordances()` keeps returning the resolved booleans (`enabled`
  falls back to the `managedBy` bucket default) and now surfaces the
  predicates as `editPredicates` / `deletePredicates`. Boolean-only inputs
  produce byte-identical output — zero behavior change for existing schemas.

  `clampManagedObjectWrites` (ADR-0092 D2 hint clamp) treats the object form
  by its explicit `enabled` flag only: per-record predicates are not a write
  grant, so managed objects stay fail-closed unless `enabled === true`.

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/observability@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/observability@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/observability@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/observability@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/observability@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- 6da03ee: fix(security): `/me/permissions` now reflects permission-set ∩ identity-write-guard, matching real server enforcement (ADR-0057 D10)

  The `/api/v1/auth/me/permissions` per-object map merged each permission set's
  explicit `objects` entries most-permissively per key, but treated `'*'` and
  named objects as independent keys — so a wildcard "Modify/View All Data" grant
  was never propagated into a per-object entry another set explicitly denied.
  That made the client's field-level security STRICTER than the server's actual
  enforcement (`PermissionEvaluator.checkObjectPermission` allows as soon as any
  set grants, including via the `'*'` modifyAll/viewAll super-user bypass, with
  no deny-wins).

  The real effective answer for a user-context caller is `permission-set grant ∩
identity-write-guard policy`, and the payload now computes both:

  1. `foldWildcardSuperUser` lifts each per-object entry's read/write bits when
     the merged `'*'` is a super-user grant — fixing the false-NEGATIVE where a
     platform admin (`admin_full_access` `'*': {modifyAllRecords}`) who also holds
     `organization_admin` (explicit identity denies) resolved to
     `sys_user.allowEdit:false` and a disabled edit form, though the server
     accepts the write (`PATCH /data/sys_user {name}` → 200).
  2. `clampManagedObjectWrites` re-clamps `managedBy: 'better-auth'` objects by
     their write affordance — fixing the false-POSITIVE the fold would otherwise
     introduce: the identity write guard (ADR-0092 D2) blocks user-context writes
     on identity tables except where the object opted in (`userActions.edit`), so
     `sys_member` / `sys_account` / `sys_session` stay `allowEdit:false` for the
     admin (read stays granted). Only `better-auth` objects are clamped — the
     guard covers only them; `system`/`config`/`append-only` objects have no such
     guard and their permission-set result stands.

  Net: the Console's per-object FLS now equals real server enforcement — the
  ADR-0092 D4 `sys_user` profile-edit affordance is unblocked for platform admins
  (the guard still narrows the write to `{name, image}`), and no other identity
  table is shown as editable when the guard would reject it.

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/observability@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/observability@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/observability@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- ac8f029: Two ADR-0090 D5 closures (#2752, #2753):

  **`GET /me/apps` sources the engine registry.** Stack apps are registered
  into the engine registry (runtime AppPlugin), not the metadata service —
  `metadata.list('app')` returned `[]` for every principal, leaving
  `tabPermissions` and `AppSchema.requiredPermissions` with no enforced
  consumer. The endpoint now reads `registry.getAllApps()` (same authority as
  the meta routes, nav contributions merged) with the metadata service as an
  additive fallback; the capability and tab filters are unchanged and now
  actually run.

  **The default baseline binds to the `everyone` anchor.** `member_default`
  carried `allowDelete` on its `'*'` grant — an anchor-forbidden bit — so
  bootstrap refused the `everyone` binding on every boot and the baseline
  flowed only through the separate fallback channel D5 explicitly rejected.
  Two aligned changes:

  - `describeHighPrivilegeBits` (spec) is calibrated to the exact ADR-0090 D5
    bit list (VAMA, delete/purge/transfer, systemPermissions). A plain `'*'`
    wildcard is no longer high-privilege by itself; the wildcard ban moves to
    the GUEST tier where D9 specifies it (`describeAnchorForbiddenBits`).
  - `member_default` drops `allowDelete` from the wildcard. **Behavior
    change:** deleting records is no longer a baseline right — members keep
    create/read/edit-own; domains that want member deletes grant them per
    object via an ordinary position-distributed set. The owner-scoped delete
    RLS stays as a narrowing defense for members who receive a delete bit
    elsewhere.

  With the baseline anchor-safe, bootstrap's existing binding path succeeds:
  "what new users get" is now literally "what is bound to `everyone`" — same
  table, same audit, same explain path (proven by the new
  `me-apps-and-everyone-baseline` dogfood).

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/observability@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/observability@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/observability@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- b1081b8: Return `405 Method Not Allowed` (with an accurate `Allow` header and a
  descriptive body) instead of an opaque `{"error":"Not found"}` 404 when a
  request hits a registered path under the wrong HTTP method.

  Hono routes a method mismatch to the same `notFound` sink as a genuinely
  missing path, so a `POST` to a `PUT`-only route (e.g. the metadata save
  endpoint `PUT /api/v1/meta/:type/:name`) gave callers no hint that the path
  exists under another verb (#2684). The server now tracks every registered
  `(method, pattern)` pair and re-matches the request path in the `notFound`
  handler: matching another method yields a 405; matching nothing stays a 404.
  This is framework-wide — every registered endpoint benefits. Static/SPA
  catch-alls registered straight on the raw Hono app are not tracked and never
  produce a spurious 405.

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/observability@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/observability@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/observability@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/observability@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/observability@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/observability@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/observability@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/observability@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/observability@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/observability@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/observability@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/observability@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/observability@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/observability@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/observability@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/observability@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/observability@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- dc2990f: Observability: per-request performance timing surfaced via the `Server-Timing` response header ("perf-tuning mode").

  `@objectstack/observability` gains a tiny, dependency-free `PerfTiming` collector plus an `AsyncLocalStorage`-backed ambient API (`runWithPerfTiming` / `currentPerfTiming` and the no-op-when-disabled free functions `measureServerTiming` / `startServerTiming` / `recordServerTiming`) and a spec-compliant `formatServerTiming` serializer that sanitizes names to tokens and quotes/escapes descriptions (no header injection).

  The Hono server plugin can now emit `Server-Timing` per request. It is **off by default** — the header discloses internal phase durations, which is a backend-fingerprinting surface — and opt-in via `new HonoServerPlugin({ serverTiming: true })` or `OS_SERVER_TIMING=true` (so it works through the default `os serve`). When enabled, every response carries `total` (measured by an outer middleware that brackets the whole request) plus the adapter-contributed `parse` and `handler` sub-phases; any code on the request's async call chain can add its own phases via the ambient API. When disabled, the timing call sites are zero-overhead no-ops.

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [dc2990f]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/observability@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/types@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Minor Changes

- 00c32f2: Expose resolved regional defaults to every authenticated user.

  Adds `GET /api/v1/auth/me/localization` returning the request tenant's resolved
  `{ currency, locale, timezone }` from the ExecutionContext (ADR-0053). The
  `localization` SETTINGS are gated to `setup.access`, but the resolved defaults
  are needed by every renderer to format currency/dates/numbers — so they are
  surfaced here without that gate. Enables a client to format a currency field
  in the tenant's default currency when the field omits its own.

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1

## 8.0.0

### Patch Changes

- 93f97b2: fix(hono-server): drain in-flight requests on shutdown instead of force-closing (P1-3)

  `HonoHttpServer.close()` called `closeAllConnections()`, which terminated active
  connections mid-response — so a SIGTERM during a rolling deploy dropped in-flight
  requests. It now drains gracefully: `server.close()` stops accepting new
  connections and lets active requests finish, `closeIdleConnections()` releases
  idle keep-alive sockets so the process exits promptly, and a bounded drain window
  (default 10s, configurable, well under the kernel's 60s `shutdownTimeout`)
  force-closes only the stragglers so shutdown can't hang.

  Note: the kernel already handles SIGINT/SIGTERM/SIGQUIT with an ordered,
  timeout-bounded shutdown — this fixes the one place that wasn't draining.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## Unreleased

### Minor Changes

- CORS middleware now exposes `set-auth-token` by default so clients can
  capture rotated bearer tokens emitted by `@objectstack/plugin-auth`.
- `HonoCorsOptions` accepts `allowHeaders` and `exposeHeaders`. User-supplied
  `exposeHeaders` are merged with the `set-auth-token` default.

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- 0bc7b0c: fix port confict
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/runtime@1.0.12
  - @objectstack/types@1.0.12
  - @objectstack/hono@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/types@1.0.11
- @objectstack/runtime@1.0.11
- @objectstack/hono@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/runtime@1.0.10
  - @objectstack/hono@1.0.10
  - @objectstack/spec@1.0.10
  - @objectstack/types@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9
- @objectstack/core@1.0.9
- @objectstack/types@1.0.9
- @objectstack/runtime@1.0.9
- @objectstack/hono@1.0.9

## 1.0.8

### Patch Changes

- 8f2a3a2: fix: standardize discovery endpoint response to include 'data' wrapper
- Updated dependencies [8f2a3a2]
  - @objectstack/hono@1.0.8
  - @objectstack/spec@1.0.8
  - @objectstack/core@1.0.8
  - @objectstack/types@1.0.8
  - @objectstack/runtime@1.0.8

## 1.0.7

### Patch Changes

- ebdf787: feat: implement standard service discovery via `/.well-known/objectstack`
- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7
  - @objectstack/hono@1.0.7
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7
  - @objectstack/types@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/runtime@1.0.6
  - @objectstack/types@1.0.6
  - @objectstack/hono@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- 877b864: fix: add SPA fallback to hono, fix msw context binding, improve runtime resilience, and fix client-react build types
- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/core@1.0.5
  - @objectstack/runtime@1.0.5
  - @objectstack/hono@1.0.5
  - @objectstack/types@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/types@1.0.4
  - @objectstack/runtime@1.0.4
  - @objectstack/hono@1.0.4

## 1.0.3

### Patch Changes

- 22a48f0: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/runtime@1.0.3
  - @objectstack/hono@1.0.3
  - @objectstack/spec@1.0.3
  - @objectstack/types@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/types@1.0.2
  - @objectstack/runtime@1.0.2
  - @objectstack/hono@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1
- @objectstack/types@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/types@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/types@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/types@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1
- @objectstack/types@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/types@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/types@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2
  - @objectstack/runtime@0.4.2
  - @objectstack/types@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized all plugin versions to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1
  - @objectstack/types@0.4.1
  - @objectstack/runtime@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3
  - @objectstack/runtime@0.3.3
  - @objectstack/types@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@0.3.2
  - @objectstack/spec@0.3.2
  - @objectstack/types@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@0.3.1
  - @objectstack/spec@0.3.1
  - @objectstack/types@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/runtime@1.0.0
  - @objectstack/types@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0
  - @objectstack/types@0.2.0
  - @objectstack/runtime@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
  - @objectstack/runtime@0.1.1
  - @objectstack/types@0.1.1
