# ADR-0062: External Datasource Runtime — connection lifecycle, credentials, visibility & query completeness

**Status**: Accepted (2026-06-22) — D1–D8 implemented. **D1 fully implemented across both repos** (#3826, closed): every open-core boot path (#3968) and every cloud composition (cloud#915 — control-plane preset, objectos `artifact-kernel-factory`, `DefaultEnvironmentKernelFactory`) connects its `default` through the one `DatasourceConnectionService` path; the remaining `DriverPlugin` uses are documented named-auxiliary/escape-hatch cases, and the degraded-boot parity guard stays to pin them (see the status notes under D1). D5's teardown half landed with #3993: kernel teardown disconnects through the same service, honouring adopted (host-owned) instances — see the amendment under D5.

**Supersedes the runtime portions of**: ADR-0015 §18 addendum (kept as the historical record). ADR-0015 remains the canonical spec/binding decision; this ADR is the canonical *runtime* decision.

## TL;DR

ADR-0015 declared external datasource federation. The declaration surface (`schemaMode`, `external.{remoteName,remoteSchema,columnMap,writable}`), the boot validation gate, the write gate, introspection + the runtime "Sync objects" wizard all shipped — and the query path now honors `remoteName`/`remoteSchema` (#2138), `columnMap` (#2149), the federated objects are visible in the datasource admin/meta REST (#2157), and there is a runnable showcase example + dogfood coverage (#2139).

**But "declare a datasource and it just works" is still not true.** A declared, non-`default` datasource is registered as *metadata* (so it is now *visible*) but is **not connected as a queryable ObjectQL engine driver** — querying its federated objects requires the app to hand-register a live driver via an `onEnable` bridge. Three further runtime concerns are unowned: credential resolution at connect, native-analytics SQL over external objects, and the `columnMap`↔`field.columnName` duplication.

This ADR defines the **complete external-datasource runtime contract** and the decisions to close those gaps with **one connection mechanism for code- and runtime-origin datasources**, a **backward-compatible, opt-in rollout** (existing managed apps unchanged), and an explicit phase plan.

## Context

### What ADR-0015 promised vs. what is live

| # | Requirement | Status | Where |
|---|---|---|---|
| R1 | Declaration + per-object binding (`schemaMode`, `external.*`) | ✅ shipped | ADR-0015; `spec/data/{datasource,object}.zod.ts` |
| R2 | **Declared datasource → queryable engine driver (no app boilerplate)** | ❌ **gap** | needs `app-plugin`/`standalone` + a connection service |
| R3 | Credentials/secrets resolved at connect (`credentialsRef`) | ⚠️ partial | `SecretBinder`/`ICryptoProvider` exist; not wired into a generic connect path |
| R4 | Visibility in `GET /api/v1/datasources` + `/meta/datasource` + Setup | ✅ shipped | #2157 (in-memory `registerInMemory` fallback) |
| R5a | Read path honors `remoteName`/`remoteSchema` | ✅ shipped | #2138 |
| R5b | Read path honors `columnMap` (remote col ≠ local field) | ✅ shipped | #2149 |
| R5c | Write gate (double opt-in) | ✅ shipped | ADR-0015 §5.3 |
| R5d | Read coercion for external (best-effort, no DDL) | ✅ shipped | #2138 `registerExternalObject` |
| R5e | **Native-analytics SQL over external objects** | ❌ **gap** | analytics service compiles its own `FROM` |
| R6 | Boot schema-validation gate + background drift | ✅ shipped | ADR-0015 §5.2 `external-validation-plugin` |
| R7 | Introspection (`remote-tables`, `object-draft`) + runtime Sync wizard | ✅ shipped | ADR-0015 addendum; `service-datasource` |
| R8 | **Connection lifecycle/health/pooling for N datasources** | ❌ **gap** | only the single `default` driver's lifecycle is managed today |
| R9 | dogfood/verify handles read-only external; canonical example | ✅ shipped | #2139 (`verify` skip + `app-showcase`) |
| R10 | **`columnMap` ↔ `field.columnName` single source of truth** | ✅ resolved | #2377 removed `field.columnName` (it was never applied by the driver); `external.columnMap` is now the sole physical-column mapping |

### The structural gap, precisely (R2)

`os dev` (standalone) connects exactly **one** driver — the `default` library (`.objectstack/data/standalone.db`), built in `packages/runtime/src/standalone-stack.ts` by detecting the driver kind from the DB URL. A `defineStack({ datasources: [...] })` entry is only registered as metadata by `packages/runtime/src/app-plugin.ts` (`registerInMemory('datasource', …)`). ObjectQL routes queries by **driver name** (`engine.getDriver(object) → this.drivers.get(object.datasource)`) and throws `Datasource 'x' is not registered` when absent. So the only way to make a federated object queryable today is the app's `onEnable` hook calling `ctx.drivers.register(driver)` (= `engine.registerDriver`) — see `examples/app-showcase/src/datasources/external-fixture.ts`. That bridge is framework plumbing leaking into every federation app.

### Why one consolidating ADR (not N small PRs)

R2/R3/R8 are the same change seen from three angles — you cannot "auto-connect" without owning **connection lifecycle** (R8) and **credential resolution** (R3). R4 (just shipped) and R2 are two faces of "declared datasource as a runtime first-class citizen" — visible *and* usable. And the connection mechanism must **converge** the code-origin path (this ADR) with the runtime-origin path (the Sync wizard already builds drivers via the injected factory for test/introspection) so we don't ship two divergent connect paths. These decisions share contracts (the injectable driver factory, the `SecretBinder`, boot ordering vs. the `kernel:ready` validation gate); deciding them piecemeal risks incoherent seams.

## Goals / Non-goals

**Goals.** A declared external datasource is, with no app code: visible (R4 ✅), connected + queryable (R2), credential-resolved (R3), validated at boot (R6 ✅), and lifecycle-managed (R8) — through **one** mechanism shared by code- and runtime-origin datasources, **without changing the behavior of existing managed apps**.

**Non-goals.** New driver dialects; replacing `DataSync`/`ExternalLookup` (ADR-0015 §9 coexistence stands); cross-datasource JOINs in one query (federated objects are queried per-datasource); multi-tenant credential vaulting beyond the existing `SecretBinder` seam.

## Decision

### D1 — One `DatasourceConnectionService`; declared datasources auto-connect

Introduce a single service that, given a datasource definition, builds a driver via the **injected** driver factory (the same `createDefaultDatasourceDriverFactory` used by the runtime-admin path), connects it, and registers it into the ObjectQL engine under the datasource name. `app-plugin` calls it for every declared datasource (in addition to today's `registerInMemory` for visibility); `standalone-stack`'s single-`default`-driver bootstrap is refactored to go through the same service so there is exactly one "definition → live driver" code path. `engine.registerDriver` remains the sink. The `onEnable` bridge becomes unnecessary for the common case (kept as an escape hatch — D8).

> **Status correction (#3826) — the `default` refactor is NOT done; the "exactly one code path" claim is half-true.** The *construction* half converged: `standalone-stack` builds the `default` driver through `createDefaultDatasourceDriverFactory` (`standalone-stack.ts`, "the SAME `create({driver,config})` used for declared/runtime datasources"). The *connect + failure-verdict* half did not, and this ADR's header has been claiming D1 as implemented while two independent implementations coexist:
>
> | | `default` | declared datasource |
> |:---|:---|:---|
> | build | shared factory ✅ | shared factory ✅ |
> | register | `DriverPlugin` → a `driver.*` kernel service, discovered in `ObjectQLPlugin.start()` | `engine.registerDriver()` inside `connect()` |
> | connect | `ObjectQLEngine.init()` | `DatasourceConnectionService.connect()` |
> | failure verdict | `DriverConnectError`, aggregate (#3741) | `handleFailure()` (#3758) |
> | pool teardown | kernel shutdown via `DriverPlugin` | `DatasourceConnectionService.disconnect()` |
> | connect policy | not consulted | `DatasourceConnectPolicy` |
>
> **Resolution (#3826, second pass) — the standalone `default` is now a declared definition.** The input-shape mismatch was resolved by making the definition the input: `createStandaloneStack` translates the database URL into a `{ driver, config }` definition (URL→config translation and `mkdir` stay host concerns) and the runtime's **`DefaultDatasourcePlugin`** — registered before `ObjectQLPlugin`, so the driver exists before boot schema-sync — connects it through `DatasourceConnectionService.connect(record, { asDefault: true })`. The definition is marked **`bootCritical`**, which adds a third fail-fast cause to D5 (the platform cannot run without it; every unbound object routes to it), sharing `OS_ALLOW_DRIVER_CONNECT_FAILURE` and the `DEGRADED BOOT` banner with the engine guard. `asDefault` keeps the driver's **natural name** (routing to `default` uses the engine's default-driver fallback, never `drivers.get('default')`) and registers with `isDefault: true`. The presumed layering inversion did not materialize: the *runtime host* orchestrates (runtime already depends on `service-datasource`); `ObjectQLPlugin` learned nothing. When the datasource-admin plugin is present its shared connection service is used (so `default` shows a real `status` in Setup → Datasources, #3827); a lite kernel instantiates the same class locally — one implementation either way. `sqlite-wasm` joined the shared factory (the last bespoke construction site), `default` became a host-reserved name (rejected in app bundles at load and in runtime-admin create), and `ObjectQLEngine.init()` keeps its #3741 fail-fast unchanged — it re-connects the already-connected default (all open-core drivers' `connect()` is idempotent), which is precisely the boot *verification* role D1 leaves it.
>
> **Config-load fallback converged too (#3826, third pass).** `createStorageDriver` is gone: the CLI's serve fallback (a host `objectstack.config.ts` with objects but no driver plugin) now emits a definition via `resolveStorageDefinition` and hands it to the same `DefaultDatasourcePlugin`. `mysql` joined the shared factory for it; the dev loosen-only self-heal (#2186) rides as `config.autoMigrate` and the CLI's wasm persistence mode as `config.persist` — host-composition passthroughs the factory honours, never part of the app-facing datasource spec. `turso`/libSQL keeps its loud typed failure at *resolution* (nothing is constructed to fail later). The `telemetry` sibling datasource deliberately stays a pre-built `DriverPlugin` (the documented escape hatch for named auxiliary drivers): it is best-effort, dev-oriented, and its own `resolveSqliteDriver` step-down check replaces the old primary-resolution coupling.
>
> **Convergence completed — the cloud compositions landed (cloud#915), no second site remains.** The cloud repo's three primary-driver sites — the control-plane preset (fed by `cloud-stack.ts`'s `buildControlDriver`, whose instance doubles as every environment kernel's proxy base), `artifact-kernel-factory.ts` (the objectos per-tenant hot path), and both `DefaultEnvironmentKernelFactory` paths — now boot through `DefaultDatasourcePlugin` with their pre-built instances adopted via `createPrebuiltDriverFactory`. Every remaining `DriverPlugin` use is a **documented named-auxiliary / escape-hatch case**, not a default path: the framework's `telemetry` sibling, the cloud proxy `cloud` datasource (`registerAsDefault: false`), the objectos host routing shell, the artifact factory's `'cloud'` alias metadata registration, and test injection. `packages/runtime/src/degraded-boot-parity.test.ts` **stays load-bearing after the convergence**, with its role shifted from "the unconverged second implementation must not drift" to "the escape hatches must not drift": as long as `ObjectQLEngine.init()` can throw a connect verdict at all (the boot re-verification, pre-built `DriverPlugin` drivers), that verdict must match the service's. #3741 → #3758 was exactly the miss it exists to catch.
>
> **The convergence seam (#3826, fourth pass).** Two properties of the cloud composition made "just declare it" impossible: its driver kinds live outside open-core (`turso`), and its instances are *pooled beyond one kernel* (the control-plane driver doubles as the proxy base of every environment kernel; per-environment drivers are cached across kernel rebuilds — reconstruction per boot would multiply pools). So `DefaultDatasourcePlugin` now accepts an **injected `IDatasourceDriverFactory`** (defaulting to the shared open-core factory), and `createPrebuiltDriverFactory` wraps an already-built instance as a factory — the "adopt an existing driver" entry point this ADR's first pass found missing, landed *as a factory* so the connect orchestration (policy-free init connect, `bootCritical` verdict, shared escape hatch, start() replay into retained state) stays this one implementation. Construction and pooling remain host concerns; only the verdict converges. The `@objectstack/verify` dogfood harness also boots through the declared default now (not the `DriverPlugin` escape hatch), making the §Risk mitigation — "behind the dogfood gate" — actually true for the converged path.

### D2 — Connect is opt-in-safe: existing managed apps are byte-for-byte unchanged

Auto-connect must not change apps that today declare datasources that are *decorative* or routed via `datasourceMapping` (e.g. `examples/app-crm`'s `crm_primary`/`crm_analytics`). Gate auto-connect so a declared datasource is only connected when it is meaningfully addressed: **(a)** it is `external` (`schemaMode !== 'managed'`), or **(b)** an object/`datasourceMapping` actually routes to it, or **(c)** it sets an explicit `autoConnect: true`. A managed datasource that nothing routes to stays metadata-only (today's behavior). The `default` datasource keeps its current dedicated bootstrap. This is the load-bearing backward-compat decision.

> **Phase 1 implementation note (#2163) — gate (b) is "explicit `object.datasource`", not "mapped".** Implementing D2 against `examples/app-crm` surfaced a conflict between "an object/`datasourceMapping` routes to it" and the "byte-for-byte unchanged" mandate. `app-crm`'s `crm_primary` (`:memory:`, `managed`) *is* referenced by a `datasourceMapping` rule (and is the `default:true` fallback) but has **no** `onEnable` driver, so today `engine.getDriver` finds no `crm_primary` driver and its objects fall through to the `default` driver. Auto-connecting it on the strength of the mapping rule would build a fresh, empty `:memory:` driver and silently divert those objects — a behavior change. So the gate **does not** auto-connect on a `datasourceMapping` rule alone: a *managed* datasource that is only mapped (namespace/package/`default`) is treated as decorative and left metadata-only. Gate (b) fires only when an object **explicitly** binds via `object.datasource === <name>` — a binding that today *throws* when the driver is unregistered, so auto-connecting it is a strict improvement, never a change. External datasources (a) and `autoConnect:true` (c) are unaffected. See `isDatasourceAddressed()` in `@objectstack/service-datasource`.
>
> **Amendment (#4462) — the phase-1 note is REVERSED: gate (d) is "a mapping rule routes objects here", and mapping-only is no longer decorative.** The note above priced the trade-off with only one side on the table. The other side, measured on `main` during the v17 verification, is what a mapping to an **unreachable** datasource does today: the boot succeeds, `/ready` answers `200`, the datasource name appears in **zero** log lines, `POST /api/v1/data/<mapped object>` returns `201` — and the row is physically in the DEFAULT store. The operator discovers it by opening the database they declared and finding it empty. Weighed against that, "decorative" is not a backward-compatibility guarantee; it is a silent data-placement bug wearing one. `datasourceMapping` reads as routing to every author who writes it, and Route-ownership rule #3 ("absence must be loud; prefer failing to falling back") applies to a routing decision as much as to a mounted surface.
>
> The amendment is a **pair**, and each half is what makes the other correct:
>
> 1. **Routing stops falling through.** `ObjectQLEngine.getDriver` step 2: a mapping rule that MATCHES and names a datasource with no live driver now throws — `DatasourceUnavailableError` when the connect layer recorded a verdict (framework#3828), otherwise a "mapped for object … is not registered" error naming the two remedies. `default` is the one name that still resolves onward: the default driver keeps its natural name (#3826), so `drivers.has('default')` is false by construction and step 5 is how routing to it works.
> 2. **The D2 gate grows (d).** A datasource a mapping rule routes at least one registered object to is auto-connected at boot, and a `declared-auto` failure is **fatal** — the same argument (b) already makes, now true of (d) because half 1 removed the fallback. The object list is resolved by the boot path from the engine's own matcher (`ObjectQLEngine.resolveMappedDatasource`), never re-derived in the connection service: two matchers drifting by one clause would connect a datasource routing never uses, or route to one nothing connects, which is the defect again.
>
> `examples/app-crm`'s mapping was **deleted** in the same change, and that is what keeps the example byte-for-byte unchanged rather than what breaks it: its `namespace: 'crm'` rule never matched (`namespace` is deprecated and no object sets it), and its `default: true → crm_primary` rule routed everything to an unconnected `:memory:` datasource, i.e. to the `default` store by fall-through. Honouring that rule would move the entire app — platform objects included — onto a database that is empty on every boot. Removing the rule states what the example actually does. The general lesson is the one #2163 half-saw: a rule the runtime ignores is not compatibility, it is an unpaid bill.

### D3 — Credentials resolved at connect via `SecretBinder`/`ICryptoProvider`

`DatasourceConnectionService` resolves `external.credentialsRef` (and any `secret` config fields) through the host-provided `SecretBinder` over `ICryptoProvider` **before** building the driver. Open-core default is `InMemoryCryptoProvider`; a datasource that needs a secret the host cannot decrypt **fails closed** (clear boot error, datasource left unconnected — not a silent skip). This reuses the exact mechanism the runtime-admin "Add Datasource" wizard already uses, so code- and runtime-origin secrets converge.

### D4 — Visibility converges on the metadata registry (shipped, ratified here)

Code-defined datasources surface in `GET /api/v1/datasources`, `GET /api/v1/meta/datasource` and **Setup → Datasources** via the single in-memory metadata registry, stamped `origin: 'code'` (read-only in the admin UI). Shipped in #2157 (the in-memory metadata fallback was missing `registerInMemory`, silently skipping registration on the host-config boot path). This ADR ratifies that the metadata registry is the single source for datasource listing across all boot paths; the admin `listDatasources` and `protocol.getMetaItems` both read it.

### D5 — Lifecycle, health & ordering for N datasources

`DatasourceConnectionService` owns connect/disconnect (graceful shutdown), pool config per datasource, and an optional health probe surfaced in the admin list (`status`). **Ordering**: all declared datasources connect **before** the `kernel:ready` external-validation gate (ADR-0015 §5.2) and before first query — i.e. during plugin init/start, not in a `kernel:ready` handler. Connect failure policy is **fail-fast when the datasource has no fallback path**, **degrade-with-warning** otherwise (a connectivity blip on an optional analytics replica should not brick boot).

> **Phase 1 implementation notes (#2163).** *Ordering* is satisfied by the kernel's two-phase boot (init-all → start-all): the connection service is registered as the `'datasource-connection'` kernel service during the datasource-admin plugin's `init()`, and declared datasources are auto-connected from `AppPlugin.start()` — which runs before the `kernel:ready` validation gate. Because boot schema-sync runs before the external driver exists, `connect()` calls `engine.syncObjectSchema()` for each bound federated object (DDL-free), so they are queryable with zero app code. *Fail-fast* is scoped to the **declared-auto** trigger; the runtime-admin create/update + boot-rehydration triggers always degrade-with-warning, preserving the pre-ADR-0062 admin behavior (a UI action never bricks the running server). *Connect policy* (the epic #2163 seam): a host-injectable `DatasourceConnectPolicy` is consulted before every connect; the open-core default allows (subject to the D2 gate), and a multi-tenant host binds a stricter, fail-closed policy for egress isolation — one connect path, no cloud fork.

> **Amendment (#3758) — "no fallback path" is the fail-fast criterion, not `onMismatch:'fail'` alone.** The original wording scoped fail-fast to `external` + `validation.onMismatch: 'fail'`, which drew the line in the wrong place: **an explicit `object.datasource` binding is a hard dependency too**, and it is one the D2 note above already identifies as having *no fallback whatsoever* — such objects never resolve to the `default` driver, `engine.getDriver` throws `Datasource 'x' is not registered` for them. So a declared datasource that 20 objects bind to, failing to connect at boot, produced the worst possible shape: a server that starts clean, serves most of the app, and fails every read/write of those 20 objects with an error that reads nothing like "the analytics database is unreachable" — harder to locate than a total outage. The **declared-auto** fail-fast set is therefore:
>
> | | Gate | Boot connect failure |
> |:---|:---|:---|
> | (a) | `external` (`schemaMode !== 'managed'`) with `validation.onMismatch: 'fail'` | **fail-fast** |
> | (b) | ≥1 object binds explicitly via `object.datasource` | **fail-fast** — no fallback path |
> | (c) | `autoConnect: true`, nothing bound | degrade-with-warning — "connect it if you can"; nothing declares a dependency |
>
> This covers every reason a connect can fail, not just an unreachable socket: an unresolvable `external.credentialsRef` (D3) and an unsupported `driver` leave the bound objects exactly as dead, so they take the same verdict. `onMismatch` keeps its own meaning (what to do about a *schema* mismatch) and is no longer overloaded as the only way to say "this datasource is required".
>
> The escape hatch is **shared with the engine-level guard**, `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` (framework#3741/#3751): the operator intent is identical ("I know the database is unreachable — boot anyway"), and two flags would only guarantee one of them gets missed. It now covers (a) as well, which previously had no opt-out. When set, the boot continues and the degraded state is announced through `emitDegradedBootBanner` (stderr as well as the logger, because `os serve`'s boot-quiet capture swallows stdout).
>
> The error message names the **bound objects** (up to 10, then `+N more`), not just the datasource — the service already receives them for post-connect `syncObjectSchema`. And `connectDeclared` attempts **every** gated datasource before throwing an aggregate, so one boot reports every misconfiguration rather than one per restart — the same shape as `ObjectQLEngine.init()`'s `DriverConnectError`.
>
> **A `DatasourceConnectPolicy` denial is not a connect failure** and stays metadata-only, unchanged. A multi-tenant host that blocks egress for a tenant's plan is making a deliberate decision about a datasource it knows it is refusing; fail-fasting there would turn a policy verdict into a boot outage for every tenant on the shared runtime. The fail-fast set covers *failures* — unreachable, unauthenticated, unsupported — not *refusals*.

> **Amendment (#3993) — teardown is one implementation too, and it distinguishes owned from adopted.** After the D1 connect convergence, "owns connect/disconnect" was half-true: nothing disconnected the `default` (or a declared datasource's pool) on graceful shutdown — `DriverPlugin` never had teardown, `ObjectQLPlugin`'s teardown never touched drivers, and the kernel's actual teardown phase is **`destroy()`** (the Plugin contract has no `stop()`; stray `stop` methods were never called). Now `DatasourceConnectionService` owns the disconnect half symmetrically: `disconnect(name, { asDefault })` resolves the default under its **natural name** (the same #3826 rule that makes `drivers.get('default')` impossible), and `disconnectAll()` — wired from `DefaultDatasourcePlugin.destroy()` and `DatasourceAdminServicePlugin.destroy()` — closes **exactly the pools this service opened** (`'connected'` states; `already-registered` drivers belong to whoever registered them). The factory handle carries the discriminator: **`ownership: 'host'`** (set by `createPrebuiltDriverFactory`) marks an ADOPTED instance whose pool outlives the kernel — the cloud constraint: the control-plane driver doubles as every environment kernel's proxy base, per-environment drivers are registry-cached across kernel rebuilds, and an LRU eviction (`kernel.shutdown()`) closing a shared pool would pull it from under every other consumer. For those, teardown clears the retained verdict and leaves the pool to its host. A welcome side effect: a file-backed `sqlite-wasm` default with `persist: 'on-disconnect'` now actually flushes on graceful shutdown.

### D6 — Native-analytics SQL honors the remote table/columns

The analytics native-SQL strategy compiles its own `FROM "<table>"` / column references outside the driver (ADR-0015 §18 noted this). It must resolve an external object's physical table (`remoteName`/`remoteSchema`) and columns (`columnMap`) the same way `SqlDriver` now does — reusing the driver's resolution (e.g. an exposed `physicalTableFor(object)` / `physicalColumnFor(object, field)`), not a second copy. Until then, analytics over external objects stays disabled rather than silently querying the wrong table.

> **Phase 3 implementation note (#2163) — "reuse the driver's resolution" = route external objects to the ObjectQL path.** Rather than re-implement `remoteName`/`remoteSchema`/`columnMap` resolution inside the native-SQL strategy (a second copy — explicitly rejected), `NativeSQLStrategy.canHandle` now **declines** any query whose base or joined object is federated (new optional `StrategyContext.isExternalObject` hook, reported by the analytics plugin from the object's `external` block). Declining routes the query to the lower-priority `ObjectQLStrategy`, whose `engine.aggregate()` already goes through the driver's `getBuilder` — which honours `remoteName`/`remoteSchema` (#2138/#2149). So external analytics aggregates against the **correct** remote table via the single source of truth (the driver), and native-SQL never queries the wrong table. (A native-SQL fast path for external objects can be added later by exposing `physicalTableFor`/`physicalColumnFor` on the driver; deeper `columnMap`-in-`GROUP BY` support is a separate driver concern.)

### D7 — `columnMap` is the external mechanism; reconcile `field.columnName`

`external.columnMap` ({ remoteColumn → localField }) is the supported way to map external columns (shipped #2149). `field.columnName` (localField → physicalColumn) is its inverse and is **not** applied by the driver's query pipeline for external objects. Decision: for external objects, `columnMap` is authoritative; `field.columnName` on an external object is rejected at validation (no silent dual-source) until a unified column-resolution model is designed. Managed objects' `field.columnName` semantics are untouched.

> **Resolution (#2377, R10 closed).** `field.columnName` was **removed from the spec entirely** (ADR-0049 enforce-or-remove): the SQL driver hardcodes the physical column = field key (`createColumn` never read `columnName`), so it was inert on *managed* objects too — not just external ones. With the field gone there is no dual-source ambiguity, so the build-time D7 rejection lint (`validateStackExpressions`) and the dead `StorageNameMapping.resolveColumnName`/`buildColumnMap`/`buildReverseColumnMap` helpers were removed with it. `external.columnMap` is the single, authoritative physical-column mechanism. Physical-column override for managed objects (e.g. legacy-DB adoption) — the only case with real value — should, if ever needed, be designed as a first-class driver feature rather than reintroduced as an unenforced field.

> **Phase 4 implementation note (#2163).** *D7* is enforced at build time in `validateStackExpressions` (`os compile`/`build`): any object that declares an `external` binding and a field with `columnName` is an error with a corrective message (use `external.columnMap`). Managed objects are untouched. *D8*: `examples/app-showcase` now declares its external datasource with **no** `onEnable` driver registration — `onEnable` only provisions the "remote" fixture tables; the declared datasource auto-connects (D1). To exercise this in the dogfood gate, the `@objectstack/verify` harness now wires the datasource-admin plugin (hence the `'datasource-connection'` service) when an app declares datasources — so the harness matches `objectstack dev`/serve and the federated read is covered end-to-end (a new dogfood test reads `showcase_ext_customer`/`_order`, including the `remoteName` remap). `onEnable` + `ctx.drivers.register` remains documented as the escape hatch for drivers built dynamically at runtime.

### D8 — Drop the `onEnable` bridge from the canonical example; keep it as an escape hatch

Once D1 lands, `examples/app-showcase` declares its external datasource with **no** `onEnable` driver-registration code (fixture provisioning may remain). `onEnable` + `ctx.drivers.register` stays supported for advanced/dynamic cases (drivers built at runtime from external config).

### Default behavior (normative)

- A declared `external` datasource auto-connects (read-only unless write double-opt-in), is visible, validated at boot, and its federated objects are queryable via REST/ObjectQL — **zero app code**.
- A declared `managed` datasource that nothing routes to remains metadata-only (unchanged).
- Missing/undecryptable credentials → fail-closed with a clear error.
- `onEnable` registration still wins if present (escape hatch).

## Phasing

- **Phase 0 — shipped**: read-path `remoteName`/`remoteSchema` (#2138), `columnMap` (#2149), showcase example + `verify` skip (#2139), visibility (#2157), ADR-0015 §18.
- **Phase 1 — `DatasourceConnectionService` + auto-connect (D1, D2, D5)**: the core. Extract "definition → live driver" from `standalone-stack`, call from `app-plugin`, gate per D2. Refactor `default` onto the same service last (highest-risk; do behind tests).
- **Phase 2 — credentials at connect (D3)**: wire `SecretBinder`; converge with runtime-admin secret handling; fail-closed.
- **Phase 3 — analytics SQL (D6)**: expose driver physical-table/column resolution; route the native-SQL strategy through it.
- **Phase 4 — reconciliation + cleanup (D7, D8)**: validation for `field.columnName` on external; drop the showcase `onEnable` bridge.

Each phase is its own PR with its own changeset; Phase 1 lands behind the full dogfood gate (every example app boots) before Phase 4 removes the bridge.

## Backward compatibility / migration / blast radius

- `app-plugin` runs for **every** stack, so D1 is high-blast — D2's opt-in gate is what keeps `app-crm` and any current datasource-declaring app unchanged (managed + unrouted → still metadata-only).
- `onEnable` + `ctx.drivers.register` remains supported (no migration forced).
- Connecting N datasources introduces N connection lifecycles (pools, disconnect on shutdown, connect-error policy) where only one existed — covered by D5 and the dogfood gate.
- Code- and runtime-origin datasources converge on one connect path (D1/D3), removing a latent divergence rather than adding one.

## Rejected alternatives

1. **Status quo — `onEnable` is the only way to connect.** Rejected: leaks framework plumbing into every federation app; the canonical example needed ~40 lines of driver wiring just to be queryable.
2. **Auto-connect every declared datasource by default.** Rejected: changes the runtime behavior of existing managed apps (e.g. `app-crm`'s `:memory:` datasources) — D2's gate is required.
3. **Separate connect mechanisms for code vs. runtime datasources.** Rejected: two divergent paths for lifecycle + secrets; converge on one service (D1).
4. **A second copy of table/column resolution inside the analytics service.** Rejected (D6): drift risk; reuse the driver's resolution.
5. **Support both `columnMap` and `field.columnName` for external objects.** Rejected (D7): silent dual-source ambiguity; pick one until a unified model is designed.

## Consequences

**Positive.** "Declare a datasource → it's visible, connected, validated, queryable" with no app code; one connection + secret path for code and runtime origins; analytics works over external objects; the canonical example shows the real flow without plumbing.

**Negative / cost.** A new connection service + lifecycle ownership; broad regression surface (every example app boots through `app-plugin`); credential plumbing pulled into the boot path.

**Risk.** Phase 1's `default`-driver refactor is the riskiest single step (the hot boot path for all apps) — mitigated by landing auto-connect for declared datasources first, refactoring `default` onto the shared service last, behind the dogfood gate. Connect-error policy (D5) must be conservative so an optional replica's blip never bricks boot.

## References

- ADR-0015 — External Datasource Federation (+ §18 runtime addendum).
- ADR-0008 — Metadata repository (datasource is a first-class metadata type).
- PRs: #2138 (read path), #2149 (columnMap), #2139 (showcase example + `verify` skip), #2157 (visibility).
- `packages/runtime/src/standalone-stack.ts`, `packages/runtime/src/app-plugin.ts` (connection + registration sites).
- `packages/objectql/src/engine.ts` (`getDriver`/`registerDriver` routing).
- `packages/services/service-datasource/src/*` (driver factory, admin, external service, `SecretBinder`).
- `packages/plugins/driver-sql/src/sql-driver.ts` (`registerExternalObject`, physical table/column resolution).
