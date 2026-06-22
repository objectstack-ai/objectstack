# ADR-0062: External Datasource Runtime — connection lifecycle, credentials, visibility & query completeness

**Status**: Proposed — recommended for acceptance; consolidates the runtime gaps surfaced while implementing ADR-0015 federation. Some requirements are already shipped (marked ✅ below); the open decisions are D1–D8 (2026-06-22).

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
| R10 | **`columnMap` ↔ `field.columnName` single source of truth** | ❌ **gap** | two inverse mechanisms coexist |

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

### D2 — Connect is opt-in-safe: existing managed apps are byte-for-byte unchanged

Auto-connect must not change apps that today declare datasources that are *decorative* or routed via `datasourceMapping` (e.g. `examples/app-crm`'s `crm_primary`/`crm_analytics`). Gate auto-connect so a declared datasource is only connected when it is meaningfully addressed: **(a)** it is `external` (`schemaMode !== 'managed'`), or **(b)** an object/`datasourceMapping` actually routes to it, or **(c)** it sets an explicit `autoConnect: true`. A managed datasource that nothing routes to stays metadata-only (today's behavior). The `default` datasource keeps its current dedicated bootstrap. This is the load-bearing backward-compat decision.

> **Phase 1 implementation note (#2163) — gate (b) is "explicit `object.datasource`", not "mapped".** Implementing D2 against `examples/app-crm` surfaced a conflict between "an object/`datasourceMapping` routes to it" and the "byte-for-byte unchanged" mandate. `app-crm`'s `crm_primary` (`:memory:`, `managed`) *is* referenced by a `datasourceMapping` rule (and is the `default:true` fallback) but has **no** `onEnable` driver, so today `engine.getDriver` finds no `crm_primary` driver and its objects fall through to the `default` driver. Auto-connecting it on the strength of the mapping rule would build a fresh, empty `:memory:` driver and silently divert those objects — a behavior change. So the gate **does not** auto-connect on a `datasourceMapping` rule alone: a *managed* datasource that is only mapped (namespace/package/`default`) is treated as decorative and left metadata-only. Gate (b) fires only when an object **explicitly** binds via `object.datasource === <name>` — a binding that today *throws* when the driver is unregistered, so auto-connecting it is a strict improvement, never a change. External datasources (a) and `autoConnect:true` (c) are unaffected. See `isDatasourceAddressed()` in `@objectstack/service-datasource`.

### D3 — Credentials resolved at connect via `SecretBinder`/`ICryptoProvider`

`DatasourceConnectionService` resolves `external.credentialsRef` (and any `secret` config fields) through the host-provided `SecretBinder` over `ICryptoProvider` **before** building the driver. Open-core default is `InMemoryCryptoProvider`; a datasource that needs a secret the host cannot decrypt **fails closed** (clear boot error, datasource left unconnected — not a silent skip). This reuses the exact mechanism the runtime-admin "Add Datasource" wizard already uses, so code- and runtime-origin secrets converge.

### D4 — Visibility converges on the metadata registry (shipped, ratified here)

Code-defined datasources surface in `GET /api/v1/datasources`, `GET /api/v1/meta/datasource` and **Setup → Datasources** via the single in-memory metadata registry, stamped `origin: 'code'` (read-only in the admin UI). Shipped in #2157 (the in-memory metadata fallback was missing `registerInMemory`, silently skipping registration on the host-config boot path). This ADR ratifies that the metadata registry is the single source for datasource listing across all boot paths; the admin `listDatasources` and `protocol.getMetaItems` both read it.

### D5 — Lifecycle, health & ordering for N datasources

`DatasourceConnectionService` owns connect/disconnect (graceful shutdown), pool config per datasource, and an optional health probe surfaced in the admin list (`status`). **Ordering**: all declared datasources connect **before** the `kernel:ready` external-validation gate (ADR-0015 §5.2) and before first query — i.e. during plugin init/start, not in a `kernel:ready` handler. Connect failure policy is **fail-fast for `external` with `validation.onMismatch: 'fail'`**, **degrade-with-warning** otherwise (a connectivity blip on an optional analytics replica should not brick boot).

> **Phase 1 implementation notes (#2163).** *Ordering* is satisfied by the kernel's two-phase boot (init-all → start-all): the connection service is registered as the `'datasource-connection'` kernel service during the datasource-admin plugin's `init()`, and declared datasources are auto-connected from `AppPlugin.start()` — which runs before the `kernel:ready` validation gate. Because boot schema-sync runs before the external driver exists, `connect()` calls `engine.syncObjectSchema()` for each bound federated object (DDL-free), so they are queryable with zero app code. *Fail-fast* is scoped to the **declared-auto** trigger; the runtime-admin create/update + boot-rehydration triggers always degrade-with-warning, preserving the pre-ADR-0062 admin behavior (a UI action never bricks the running server). *Connect policy* (the epic #2163 seam): a host-injectable `DatasourceConnectPolicy` is consulted before every connect; the open-core default allows (subject to the D2 gate), and a multi-tenant host binds a stricter, fail-closed policy for egress isolation — one connect path, no cloud fork.

### D6 — Native-analytics SQL honors the remote table/columns

The analytics native-SQL strategy compiles its own `FROM "<table>"` / column references outside the driver (ADR-0015 §18 noted this). It must resolve an external object's physical table (`remoteName`/`remoteSchema`) and columns (`columnMap`) the same way `SqlDriver` now does — reusing the driver's resolution (e.g. an exposed `physicalTableFor(object)` / `physicalColumnFor(object, field)`), not a second copy. Until then, analytics over external objects stays disabled rather than silently querying the wrong table.

### D7 — `columnMap` is the external mechanism; reconcile `field.columnName`

`external.columnMap` ({ remoteColumn → localField }) is the supported way to map external columns (shipped #2149). `field.columnName` (localField → physicalColumn) is its inverse and is **not** applied by the driver's query pipeline for external objects. Decision: for external objects, `columnMap` is authoritative; `field.columnName` on an external object is rejected at validation (no silent dual-source) until a unified column-resolution model is designed. Managed objects' `field.columnName` semantics are untouched.

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
