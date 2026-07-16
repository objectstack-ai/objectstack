# ADR-0076: objectql is the data engine — relocate metadata management (protocol) out of it; enforce the boundary; defer the engine repo-split

**Status**: Proposed (2026-06-28, rev. 9) — D1–D12 below. D9 step-1 (interface segmentation) shipped in #2429; OQ#7 resolved (keep `metadata-protocol` name). rev.9 adds **D12 (honest capabilities** — discovery must not report stub/fallback services as real; the analytics fallback + dev stubs are marked honestly, not deleted) and corrects the D10 analytics note (deliberate fallback + `replaceService`, not a collision). — v12 assessment. Verified 2026-07-16: D1 (metadata-protocol extraction + back-compat re-export), D2 (core-boundary ratchet test), D9-step1 (segmented protocol interfaces) confirmed in code; D3 capability/profile contract unbuilt; D12 schema half landed but runtime enforcement missing (`http-dispatcher.ts` `svcAvailable` still hardcodes `status:'available'` for every service); D7/D10/D11-decomposition deferred as designed.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (sys_metadata overlay substrate), [ADR-0025](./0025-plugin-package-distribution.md) (plugin package distribution), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (open-core boundary), [ADR-0048](./0048-cross-package-metadata-collision.md) (package id is the addressing unit), [ADR-0066](./0066-unified-authorization-model.md) (secure-by-default, posture-gated bypass)
**Consumers**: **new** `@objectstack/metadata-protocol` (receives `protocol` + `sys-metadata-repository` + `metadata-diagnostics`), `@objectstack/objectql` (loses protocol → becomes a lean data engine; keeps a back-compat re-export), `@objectstack/metadata-core` (gains the `SysMetadataEngine` interface), `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/spec`, and out-of-tree embedders — notably `../objectbase` (its `gateway`).

**Premise**: objectql was conceived as "a metadata-driven ORM that replaces TypeORM." It has outgrown that framing: it is a metadata-driven **data engine** sitting on top of knex (`driver-sql` → `knex@^3.2.10`). The complexity the team feels is not the engine; it is everything layered above and *beside* it — including `protocol.ts` (268KB of sys_metadata management / draft-publish / package ownership / locks) which lives *inside the objectql package by historical accident*, not by design.

> **Trigger**: `../objectbase`'s `gateway` wants to embed only the objectql engine without the platform. While scoping that, a sharper observation surfaced: **`protocol.ts` is metadata-domain code mis-located in the data-engine package.** Measurement confirms it (below). Relocating it — not a subpath, not a repo split — is the correct, cheap, *now* move that makes objectql lean by construction.

---

## TL;DR

1. **knex is a SQL query builder objectql already uses**, not an ORM to switch to. Retreating forfeits the one-library / one-object-model goal and removes none of the felt complexity.
2. **`protocol.ts` does not belong in the objectql package.** It implements `ObjectStackProtocol` (the contract lives in `@objectstack/spec`), manages sys_metadata, locks, commits, package ownership — pure metadata-domain work. It uses the engine only as storage, through a **5-method `SysMetadataEngine` interface** injected at runtime.
3. **Measured coupling makes the relocation cheap.** Last month: `protocol.ts` changed 47×; only **3 (6%)** also touched `engine.ts`, while **20 (43%)** touched `metadata-core`/`metadata`/`spec`. Blast radius of the move is **2 source files** (`plugin.ts` wiring, `index.ts` re-export). Its two helpers (`sys-metadata-repository`, `metadata-diagnostics`) depend only on `metadata-core`/`spec`/`types` and move with it.
4. **Decision (now):** relocate `protocol` + helpers into a **new `@objectstack/metadata-protocol`** package between `metadata-core` (pure contracts) and `metadata` (plugin). objectql becomes a lean data engine **by construction** — the 268KB genuinely leaves the package; the gateway depends on objectql with no protocol. Add a **boundary ratchet** so the engine stays pure. Add the **capability/profile** contract for optional permissions. Formula stays in core.
5. **Decision (later, separate concern):** extracting the *engine itself* into a standalone repo remains **trigger-gated** on its cross-package commit ratio (currently **88%** for `engine.ts`/`registry.ts`). That is orthogonal to — and unblocked by — the protocol relocation.

6. **Kernel review — the deeper debt is the contract, not the engine.** The engine hard-codes **zero** governance (RLS/RBAC/owner/tenant are all pluggable) and is the part to protect. But the central wire contract `ObjectStackProtocol` is a **70-method, 11-domain god-interface** (60/70 optional; no consumer uses >11%). Decision: **segment it per ISP** into `DataProtocol` + `MetadataProtocol` + optional capability protocols, keeping a composed alias for back-compat (see D8–D9). Spec/type-level and incremental.


7. **No unified protocol interface; transport is a framework-agnostic port.** The "unified" need is already met by the runtime discovery `services` registry + a shared envelope/error spine — not by the `ObjectStackProtocol` union, which is dissolved (D9 refinement). Dispatch stays a framework-agnostic port (multi-adapter; only Hono today) with per-domain plugins registering normalized handlers (D11).


## Context: the layers

| Layer | What it is | Where it lives today | Where it should live |
|---|---|---|---|
| SQL generation | dialect/pool/binding | `knex` (in `driver-sql`) | unchanged |
| **Data engine** | QueryAST→driver; CRUD; hooks; validation; formula | `objectql/src/{engine,registry,validation,hook-wrappers}` | unchanged (this is `@objectstack/objectql`) |
| **Metadata management** | `ObjectStackProtocol` impl; sys_metadata CRUD; draft/publish; locks; ownership; diagnostics | **`objectql/src/protocol.ts` (mis-located)** + `metadata-core` + `metadata` plugin | **new `@objectstack/metadata-protocol`** |
| Governance | RLS, sharing, field perms | `plugin-security`, `plugin-sharing` (already separate) | unchanged |

## Decision data

```
protocol.ts commits last month:        47
  also touched engine.ts:               3  (6%)    ← protocol↔engine ≈ decoupled
  also touched metadata-core/metadata/spec: 20  (43%)  ← its real neighbors
import sites of ObjectStackProtocolImplementation (source): plugin.ts, index.ts   (+ co-located helpers)
engine surface protocol needs: SysMetadataEngine = { find, findOne, insert, update, delete, transaction? }  (injected)

(for contrast) engine.ts/registry.ts commits last month: 50, of which 44 (88%) cross-package → engine itself NOT separable yet
```

## Decision

### D1 — Relocate protocol out of objectql into `@objectstack/metadata-protocol` [new — the centerpiece]

- Move `protocol.ts`, `sys-metadata-repository.ts`, `metadata-diagnostics.ts` from `@objectstack/objectql` into a **new `@objectstack/metadata-protocol`** package.
- Move the `SysMetadataEngine` interface into `@objectstack/metadata-core`; `metadata-protocol` depends on `metadata-core` + `spec` + `core` (for `IDataEngine`) + `types` — **not on the objectql package**. The concrete engine is injected at runtime (as today).
- `@objectstack/objectql` re-exports `ObjectStackProtocolImplementation` from the new package for back-compat (the only two source importers — `plugin.ts`, `index.ts` — are updated; `plugin.ts` keeps wiring it, now imported from `metadata-protocol`).
- Result: objectql is a lean data engine **by construction** — 268KB of metadata logic physically leaves the engine package. The gateway depends on `@objectstack/objectql` and never pulls protocol. (This **replaces** the rev.3 `./core` subpath proposal, which was a workaround for the false premise that protocol must stay in objectql. A subpath remains an optional later polish to also exclude the small `ObjectQLPlugin`/`kernel-factory` glue.)


> **Refined by D10** — this `@objectstack/metadata-protocol` *implementation* package is a pragmatic **intermediate** (it got protocol out of the engine, unblocking the lean gateway). It is **not** the end-state: D10 reserves the name "protocol" for the contract and distributes implementations to their domain packages.

### D2 — Boundary ratchet keeps the engine pure [new — keystone]

A CI test asserts `@objectstack/objectql` does **not** import `@objectstack/metadata-protocol` / `plugin` / `kernel` (the dependency points one way: `metadata-protocol → objectql-public-interface`, never back). This makes the relocation durable and creates backpressure against the engine re-absorbing metadata/platform concerns — the root cause of the original complexity. Fits the team's existing ratchet culture (liveness / api-surface / authz-matrix).

### D3 — Capability + profile contract for optional governance [new, extends ADR-0066]

Required capabilities are **derived** from object declarations (RLS block → `rls`; `requiredPermissions` → `permissions`; sharing → `sharing`). Plugins declare `provides: [...]`. The host validates at boot; **default fail-closed**. A host may run without the authz surface via an explicit `profile: 'trusted' | 'internal'` — **two-key**: build-time plugin absence + explicit runtime assertion; production env-gated. Lifts ADR-0066 posture-gated bypass to the assembly layer.

### D4 — Formula stays in core [ruled]

`@objectstack/formula` is used by `engine.ts` (formula fields), `validation/rule-validator.ts`, `hook-wrappers.ts`, `seed-loader.ts` — a hard dependency of the engine. `cel-js` is small and not the complexity driver.

### D5 — One object model, authored once [existing → ruled]

Definitions live in `@objectstack/spec` (zero runtime deps); gateway and backend import the same `*.object.ts` and call the same engine; only the installed capability set differs.

### D6 — Capabilities attach uniformly across assembly modes [existing → ruled]

RLS/permissions/sharing attach via engine **middleware** (`ql.registerMiddleware(...)`) + hooks — kernel-independent. Ratify this as the public, supported capability-attachment API.

### D7 — Engine repo-split is a separate, trigger-gated future phase [sequencing]

Extracting the *engine* into a standalone repo (the `objectui` sibling-link, no-publish model) is gated on the engine's cross-package commit ratio (currently **88%**) falling. This ADR's relocation (D1) is independent of and unblocked by D7. `objectui` separates cleanly because it is a stable downstream leaf; the engine is an upstream foundation still in 88% cross-cutting co-evolution — separating it now would reproduce the overhead that caused the earlier `@objectql/core` merge-back.

### D8 — The engine stays a pure, governance-free primitive [ratify — kernel review]

A deep read of `engine.ts` (~3.3k LOC) confirms it hard-codes **no** governance: RLS, RBAC, field-masking, owner stamping, and tenant `organization_id` are all injected by plugins via `registerMiddleware` + hooks (`plugin-security` / `plugin-sharing` / `org-scoping`); the driver port is minimal (CRUD+DDL); boot ordering is sound. This pluggable-primitive property is the kernel's most valuable asset. **No protocol, metadata-management, or governance logic may enter the engine** — protect this over any tidiness goal (the `./core` ratchet, D2, guards it).

### D9 — Segment the `ObjectStackProtocol` god-interface per ISP [new — kernel review]

The central contract in `spec/api/protocol.zod.ts` bundles **70 methods across 11 unrelated domains** — Data (9), Metadata (8), Feed (13), Notifications (7), Realtime (6), Packages (6), Views (5), Permissions (3), Workflows (3), AI (3), i18n (3), Analytics (2), Automation (1). **60/70 are optional, and no consumer uses more than ~11%** (REST ~11%, objectql ~2%, analytics ~3%). It aggregates domains that already have their own services (`service-analytics` / `service-realtime` / `service-messaging`), which forces the ~5.6k-LOC facade, makes the contract un-versionable, and is the root cause of the `metadata-protocol` naming confusion (the package also carries the thin data facade).

Decision — split the interface into focused contracts:
- **`DataProtocol`** — `findData/getData/createData/updateData/deleteData` (+ batch): thin wire-normalizers over the engine.
- **`MetadataProtocol`** — metadata read/write, draft/publish, locks (ADR-0010), commits (ADR-0067), package ownership (ADR-0048), `loadMetaFromDb`: the heavy control plane (the true content of `@objectstack/metadata-protocol`).
- **Optional capability protocols** — `AnalyticsProtocol` / `FeedProtocol` / `RealtimeProtocol` / `NotificationProtocol` / `ViewProtocol` / …, each owned by its existing service and independently optional/versionable.
- **Back-compat** — keep `ObjectStackProtocol = DataProtocol & MetadataProtocol & Partial<…>` as a composed alias so current callers/types keep working.

The segmentation is **spec/type-level and may start incrementally now** (define sub-interfaces; narrow consumers over time). The implementation restructure + the `@objectstack/metadata-protocol` rename are breaking and ride the **same cross-repo window as D7 / Step 2**.

**Refinement (rev.7) — the composed alias is transitional; the end-state has no union interface.** The platform already carries the two things a "unified protocol" is actually for, and neither is the god-interface: (a) a **runtime discovery `services` registry** (`spec/api/discovery.zod.ts` — `services` is "the single source of truth for service availability"; `capabilities`/`features` was *removed* as derivable from `services[x].enabled`), and (b) a **shared envelope/error spine** (`spec/api/errors.zod.ts`, `shared/error-map.zod.ts`, `dispatcher.zod.ts`). So `ObjectStackProtocol` is a static, lesser duplicate of the runtime `services` map. **End-state: dissolve `ObjectStackProtocol`** — keep N independent domain protocols + the thin shared spine + the discovery registry; the composed `&` alias is a back-compat shim only, deleted at the cross-repo window. This is strictly better for tiering ("what can this server do" = what is installed/enabled, computed at runtime).

### D10 — "protocol" is a contract, not an implementation package; distribute impls to domain packages [new — kernel review]

A single `ObjectStackProtocolImplementation` facade — and any `*-protocol` *implementation* package — is the wrong end-state. Verified against source:
- The facade implements only **4 of the 11** contract domains (data, metadata, analytics, feed). The other 7 (realtime / notifications / workflow / ai / i18n / views / permissions) are **not implemented in it** — they belong to their own services or aren't implemented at all.
- **Analytics uses a deliberate fallback + `replaceService` pattern (NOT a collision/bug — corrected in rev.9)**: `registerService` throws on duplicate (`core/kernel.ts`), so `ObjectQLPlugin` registers a lightweight ~66-line analytics **fallback** (so `/analytics` doesn't 404 in minimal deployments), and `AnalyticsServicePlugin`, when installed, calls **`ctx.replaceService('analytics', …)`** to swap in the full ~1.8k-LOC engine (three strategies incl. native-SQL). With service-analytics present the real engine serves (no shadowing); without it the fallback serves. The fallback duplicates *logic* only (a minor maintenance cost) and is intentional and harmless.
- **Feed is already delegated** to `IFeedService`; the facade only forwards.
- The domain service packages already exist: `service-analytics`, `service-messaging`, `service-realtime`.

Target end-state:
- **"protocol" names ONLY the contract** — the segmented interfaces in `@objectstack/spec/api` (D9). There is **no `*-protocol` implementation package**.
- **`DataProtocol`** impl → engine-adjacent / transport (thin wire-normalizers).
- **`MetadataProtocol`** impl → stays in **`@objectstack/metadata-protocol`** (name **retained** — already published; renaming churns downstream for ~0 benefit). The package's *content* converges to the metadata-management impl (it owns `sys_metadata`). The `protocol` in the name is a deliberate, low-cost naming exception from being published — the real contract lives in `@objectstack/spec/api`, not here. (Open Question #7, resolved.)
- **Analytics / Feed / Realtime / Notification / …** → each domain's *full* impl lives in its existing service package. For analytics specifically, the `ObjectQLPlugin` fallback **must be preserved or consciously dropped** (it prevents `/analytics` 404 for deployments without service-analytics) — **not blindly deleted**. Feed already delegates to `IFeedService`. The engine keeps only the minimal fallback it deliberately provides.
- **The transport/dispatcher routes each contract-slice to the owning service** (it already resolves services by name) — no central facade class.

This **refines D1** (the `metadata-protocol` package was an intermediate, not the end-state) and **completes D9**. Executed at the cross-repo window with D7 / Step 2.

### D11 — Transport stays a framework-agnostic port (multi-adapter); decompose the central dispatcher; domains register normalized handlers [new — kernel review]

The transport layer repeats the kernel's recurring pattern — a **clean port with a god implementation**:
- **Clean port (keep / ratify)**: `runtime/http-dispatcher.ts` is framework-agnostic (no Hono import; normalized `HttpProtocolContext` → `HttpDispatcherResult`); `IHttpServer` is a `@objectstack/spec/contracts` interface; `plugin-hono-server` is an *adapter* that translates `c.req` → the normalized context. This ports-and-adapters seam is exactly why a non-Hono adapter (Express/Fastify/Workers) would be **additive, not a rewrite** — it was deliberately abstracted for multi-adapter and is correct.
- **God implementation (fix)**: the dispatcher (~3.8k LOC) hardcodes a handler per domain (`handleData`/`handleMcp`/`handleAnalytics`/`handleActions`, each `getService(...)`); `rest/rest-server.ts` (~5.1k LOC) is a second central route generator. Core protocol routes are written together here — even though plugin/manifest route-contribution already exists (`core/api-registry.ts`, manifest "API route contributions to HttpDispatcher", `IHttpServer.route`).

Decision: each capability plugin registers its routes as a **normalized handler** into a thin dispatcher registry (the framework-agnostic port) — **not** as framework-specific routes. (Registering Hono `app.route` directly would couple plugins to Hono and break multi-adapter.) The central dispatcher / rest-server decompose into a thin core + per-domain contributions; adapters stay below, unchanged. Incremental (both mechanisms already coexist — migrate one domain at a time). Cross-repo window.

**Caveats**: (1) multi-adapter is currently **unproven** — only the Hono adapter exists and the normalized context shows Hono-isms (e.g. backfilling host from `c.req.url`); writing a second adapter (even a thin Workers/Express one) is the only real validation that the port is clean. (2) `http-dispatcher` (~3.8k) and `rest-server` (~5.1k) appear to **overlap** (two central transport layers touching data-CRUD routes) — confirm whether that is redundancy to consolidate.

### D12 — Honest capabilities: discovery must distinguish real services from stubs/fallbacks [new — kernel review]

**Root cause of agents being misled.** Several plugins register stub / dev / fallback services under canonical names, and the discovery builder reports *any* present service as fully real: `runtime/http-dispatcher.ts`'s `svcAvailable` hardcodes `{ enabled: true, status: 'available', handlerReady: true }` for every registered service — it **ignores stub markers** (its own comment even says "handlerReady:false … may be served by a stub", but the code never computes it). So `discovery.services.*` claims capabilities that are only stubbed, and consumers (AI agents, the console) trust them. A dev AI stub advertised this way has already confused an agent.

**Inventory of current fakes / mis-reports:**
- `plugin-dev` registers ~8 dev stubs — `storage` / `search` / `automation` / `graphql` / `analytics` / `realtime` / `notification` / `ai` (they already carry a `_dev: true` marker that nothing respects).
- `ObjectQLPlugin` registers a ~66-line `analytics` **fallback** (the D10 note — deliberate, but it reports as fully available).
- `http-dispatcher.ts` `svcAvailable` — the hardcode above.

**Decision — honest capabilities:**
1. A registered service that is a stub / dev / fallback MUST self-identify with a **standard marker** (standardise one; `_dev` is the existing precedent).
2. Discovery MUST respect it: such services report **`status: 'stub'` (or `'degraded'`) with `handlerReady: false`**, never `status: 'available'`. Add the status value to the discovery schema.
3. Consumers (agents, console) treat **only `handlerReady: true` / `status: 'available'`** as a real capability; `stub`/`unavailable` ⇒ do not use for real work.

This fixes the **whole class at once — without deleting any fallback** (no `/analytics` 404 regression): the analytics fallback and the dev stubs simply stop *lying*; they keep serving but are honestly labelled. It is the runtime enforcement of the D9-refinement principle (capabilities = what is actually installed, computed at runtime).

**Supersedes the rev.9 analytics conclusion**: the fix for the analytics fallback is to **mark it honestly (this D12)**, not "preserve-or-delete".

**Execution**: framework (marker convention + `svcAvailable` respects it + discovery schema `stub` status) and console (read the honest status) land **together at the cross-repo window** — the console reads `discovery.services`, so this is a cross-repo contract change.


## Feasibility (verified against current source)

| Claim | Status | Evidence |
|---|---|---|
| protocol is metadata-domain, not engine | ✅ | implements `ObjectStackProtocol` (`spec/api`); manages sys_metadata/locks/commits/ownership |
| protocol decoupled from the engine | ✅ | 6% commit co-change with `engine.ts`; needs only the 5-method `SysMetadataEngine` (injected) |
| relocation blast radius is tiny | ✅ | only `plugin.ts` + `index.ts` import the impl; helpers depend only on metadata-core/spec/types |
| splitting protocol saves engine deps | ✅ (for the engine package) | protocol's deps (spec/*, core, metadata-core) leave with it; engine keeps only its own |
| engine itself separable now | ❌ | 88% of engine/registry commits cross-package → D7 deferred |

## Worked example

```ts
// Gateway (objectbase) — depends on the (now lean) engine; protocol is simply not in the package
import { ObjectQL } from '@objectstack/objectql';
import { MemoryDriver } from '@objectstack/driver-memory';
import { Account } from '@shared/objects/account.object'; // SAME definition as the backend

const engine = new ObjectQL({ profile: 'trusted' });
engine.registerDriver(new MemoryDriver(), true);
await engine.init();
engine.registry.registerObject(Account);
await engine.find('account', { where: { active: true } });

// Backend — adds metadata management + governance on top of the same engine
import { createObjectQLKernel } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SecurityPlugin } from '@objectstack/plugin-security';
```

## Phasing

1. **P1 — Relocate protocol** to `@objectstack/metadata-protocol` (move 3 files; move `SysMetadataEngine` into metadata-core; update `plugin.ts` import + `index.ts` re-export). Behavior unchanged.
2. **P2 — Boundary ratchet** (objectql must not import metadata-protocol/plugin/kernel) + export-surface ratchet.
3. **P3 — Capability/profile contract** (the only substantial new code).
4. **P4 — Standalone embed example + smoke** under `examples/`.
5. **Later (D7)** — engine repo-split when the cross-package ratio drops.

## Consequences

- **+** objectql is lean by construction; protocol lands in its proper domain; real enforced package boundary (not a convention); gateway unblocked; all without breaking downstream (re-export shim).
- **+** Cheap and low-risk now (6% coupling, 2-file blast radius, narrow injected interface).
- **−** One new package in the fixed version group; a major-version bump for the moved export (mitigated by the re-export shim).
- **Risk (highest)**: capability/profile under-specified → silent authz bypass. Mitigation: default fail-closed; `trusted` two-key + prod env-gate; authz-matrix ratchet.
- **Risk**: tsup DTS stricter than tsc / turbo build-order during the package move. Mitigation: incremental, watch DTS.

## Open questions (with recommended positions)

1. **protocol's new home** — resolved: a dedicated **`@objectstack/metadata-protocol`** between `metadata-core` (kept pure) and the `metadata` plugin (avoids dragging chokidar/fs deps onto pure runtime protocol logic).
2. **`SysMetadataEngine` interface home** — recommend `@objectstack/metadata-core` (it is a contract; metadata-protocol depends on metadata-core anyway).
3. **Capability granularity** — derive from object declarations; do not overload per-user `requiredPermissions`.
4. **`trusted` profile** — two-key (build-time absence + explicit runtime assertion), prod env-allowlisted.
5. **D7 trigger threshold** — what cross-package ratio (from 88%) over what window signals "extract the engine"? Track in CI; set on first review.
6. **Data-facade home** — does the `DataProtocol` impl live in the engine-adjacent transport layer / `rest`, or a small `@objectstack/protocol-data`? (It is thin and transport-shaped.)
7. **Metadata package name (post-segmentation)** — **Resolved: keep `@objectstack/metadata-protocol`** (already published; renaming has ~0 benefit and real churn). The `protocol` suffix is a low-cost naming exception — the contract is in `@objectstack/spec/api`; a README note in the package should clarify impl-vs-contract.
8. **Per-domain versioning** — once segmented, do capability protocols get independent version markers / a `getCapabilities()` discovery method?
9. **dispatcher vs rest-server overlap** — are `runtime/http-dispatcher` (~3.8k) and `rest/rest-server` (~5.1k) redundant central transport layers? Consolidate or delineate (D11).
10. **Validate multi-adapter** — write a second `IHttpServer` adapter (thin Workers/Express) to prove the port is free of Hono-isms before relying on it (D11).
11. **D12 stub marker** — standardise the self-identifying marker: reuse `_dev`, introduce `__stub: true`, or a richer per-service capability descriptor? (Decide when D12 is implemented.)
