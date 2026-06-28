# ADR-0076: objectql layering — a lean embeddable surface, an enforced engine↔platform boundary, and a trigger-gated path to a standalone repo

**Status**: Proposed (2026-06-28, rev. 3 — data-driven) — feasibility + value assessment for the next major (v12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0025](./0025-plugin-package-distribution.md) (plugin package distribution), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (open-core boundary), [ADR-0048](./0048-cross-package-metadata-collision.md) (package id is the addressing unit), [ADR-0066](./0066-unified-authorization-model.md) (secure-by-default `access`, `requiredPermissions`, posture-gated RLS bypass), [ADR-0070](./0070-package-first-authoring.md) (package-first authoring)
**Consumers**: `@objectstack/objectql` (gains a `./core` subpath entry; no package split), `@objectstack/formula`, `@objectstack/plugin-security`, `@objectstack/plugin-sharing`, `@objectstack/spec` (shared object model), the host boot path (`createObjectQLKernel`), and out-of-tree embedders — notably `../objectbase` (its `gateway`).

**Premise**: objectql was conceived as "a metadata-driven ORM that replaces TypeORM." It has outgrown that framing: it is a metadata-driven **data engine** that sits *on top of* knex (`driver-sql` depends on `knex@^3.2.10`) with an application platform layered above (RLS, sharing, field permissions, formula, protocol/metadata management, federation). The "ORM ambition" is not the source of complexity; the platform above the engine is — and that platform is the product value.

> **Trigger**: `../objectbase` (its `gateway` — a thin, latency-sensitive host for some core algorithms) wants to use *only* the objectql engine without dragging in the whole platform; an agent inspecting the source recommended dropping objectql for raw knex. Investigation showed this is **half perception** (the engine already runs standalone; `protocol.ts` — 268KB — is never loaded for basic CRUD) and **half a productization gap** (no lean entry point, no standalone example). The team previously ran objectql as a *separate repo* (`@objectql/core`) and merged it back due to maintenance overhead, but notes `../objectui` proves a viable separate-repo model (sibling checkout, local link, no publishing). This ADR decides the layering for v12 **based on measured engine↔platform coupling**, not on aesthetics.

---

## TL;DR

1. **knex is not an ORM; it is a SQL query builder — and objectql already uses it.** "Use knex instead of objectql" is a category error; objectql is a *consumer* of knex, not a competitor. Retreating to TypeORM/knex forfeits the one-library / one-object-model goal and eliminates none of the felt complexity.
2. **Splitting protocol into its own package saves ≈ 0 dependencies** (verified: `protocol.ts` adds no third-party or workspace dep; engine+registry's only external import is `node:async_hooks`). The footprint argument for a package split does not hold.
3. **The engine API is NOT stable enough to freeze or separate today.** Measured over the last month: of 50 commits touching `engine.ts`/`registry.ts`, **44 (88%) also changed files outside the objectql package** — high-frequency cross-package co-evolution. Separating now would convert ~44 atomic commits/month into two-repo coordinated PRs.
4. **Decision (sequenced):** *Now* — stay in the monorepo; ship the lean value **additively** (a `./core` subpath entry, a standalone example) and **impose discipline** (an engine↔platform boundary ratchet + a capability/profile contract). *Later* — when the cross-package ratio falls (engine stabilizes), extract a standalone `objectql` repo on the `objectui` model. The boundary ratchet is the forcing function that drives that ratio down.
5. **One object model everywhere:** object definitions live in `@objectstack/spec` (zero runtime deps); gateway and backend import the *same* `*.object.ts` and call the *same* engine — only their installed capability set differs.
6. **Formula stays in core** (used by validation, L1 hooks, and seed loader — not just formula fields). `cel-js` is small and is not the complexity driver; the 268KB `protocol.ts` is.

## Context

### The conflated mental model

| Layer | What it is | Where it lives | Complexity |
|---|---|---|---|
| **SQL generation** | dialect, pooling, binding | `knex` (in `driver-sql`) | outsourced — not ours |
| **Data engine ("the ORM")** | QueryAST → driver; CRUD; hooks; validation; formula | `engine.ts`, `registry.ts`, `validation/`, `hook-wrappers.ts` | small, *should be* stable — what the gateway wants |
| **Application platform** | RLS, sharing, field perms, protocol/metadata mgmt, federation, REST/GraphQL, UI gen | `plugin-security`, `plugin-sharing`, `protocol.ts`, rest, … | large — **the product value** |

The "it keeps getting more complex" feeling maps to row 3. The cure is an **explicit, enforced boundary** between rows 2 and 3 — not abandoning the engine, and not (yet) physically separating it.

### What the gateway needs

`formula` + `hooks` wanted; permissions/RLS **optional**, assembled per host by third parties; same library; ideally the same object definitions; multi-backend; future merge into the platform.

## Decision data (the deciding measurement)

Last month, commits touching `engine.ts` or `registry.ts`:

```
total:                         50
also touched files OUTSIDE the objectql package:  44  (88%)
isolated to the objectql package:                  6  (12%)
```

Representative titles are inherently cross-package atomic commits: `feat(objectql,spec)`, `feat(spec,objectql,platform-objects)`, `feat(driver-sql,objectql)`, `feat(automation,objectql)`, `feat(objectql,webhooks)`. **The engine is in active co-evolution with spec/security/analytics/automation/driver-sql/webhooks — its API cannot be frozen, and therefore cannot be cheaply separated, right now.** This is *the* fact that orders the decision below.

## Decision

### D1 — Lean entry via a `./core` subpath, not a package split [new]

Add `@objectstack/objectql/core` exporting only the engine surface (engine + registry + hooks + validation + formula + driver contract). The gateway imports `@objectstack/objectql/core`; `@objectstack/objectql` (root) keeps re-exporting everything for backward compatibility. No new package, no breaking change. Tree-shaking (ESM + `sideEffects:false`) keeps `protocol.ts` out of the core entry's graph; in a Node host the unused file is effectively free.

### D2 — Enforce the engine↔platform boundary with a ratchet [new — the keystone]

A CI test (custom import-scan or dependency-cruiser) asserts core modules (`engine`, `registry`, `hooks`, `validation`) **never import** `protocol` / `plugin` / `kernel`. Today this invariant holds only *accidentally* (`engine.ts` does not import `protocol.ts`; protocol imports the engine *type* only). The ratchet makes it durable and — crucially — creates **backpressure against the engine absorbing platform concerns**, which is the root cause of the complexity that prompted this ADR. Fits the team's existing ratchet culture (liveness / api-surface / authz-matrix).

### D3 — Capability + profile contract for graceful degradation [new, extends ADR-0066]

The hard case: the same `account.object.ts` declares RLS / field permissions; the backend enforces them; the gateway deliberately does not.

- **Required capabilities are *derived*** from what the object declares (RLS block → `rls`; object/field `requiredPermissions` → `permissions`; sharing rules → `sharing`). No hand-maintained list.
- Plugins **declare what they provide**: a `provides: ['rls', ...]` field (today they carry only `name`/`dependencies`).
- The host **validates derived-vs-provided capabilities at boot**. **Default profile = fail-closed** (a derived authz capability with no provider → refuse to load; consistent with ADR-0066).
- A host may set `profile: 'trusted' | 'internal'` to legitimately run without the authz surface. **Two-key**: build-time absence of the authz plugin (no enforcement code to bypass) *plus* an explicit runtime `profile:'trusted'` assertion the boot validator requires. Never a single runtime boolean that disables an *installed* enforcement; production refuses `trusted` unless env-allowlisted. This lifts ADR-0066's posture-gated bypass from the *runtime* to the *assembly* layer.

### D4 — Formula stays in core (NOT optional) [ruled]

`@objectstack/formula` is used in the core path in four places — `engine.ts` (formula fields), `validation/rule-validator.ts` (conditional/format validations), `hook-wrappers.ts` (L1 expression hooks), `seed-loader.ts` (dynamic seed values). It is therefore a hard dependency of the core surface. `cel-js` is small and not the complexity driver.

### D5 — One object model, authored once [existing → ruled]

Object definitions stay in `@objectstack/spec` (zero runtime deps). Gateway (`/core`) and backend (`objectql`) import the **same** `*.object.ts` and register via the same `registry.registerObject(...)`.

### D6 — Capabilities attach uniformly across assembly modes [existing → ruled]

RLS/permissions/sharing already attach as engine **middleware** (`ql.registerMiddleware(...)`) plus optional hooks — kernel-independent. Ratify `registerMiddleware` + hooks as the **public, supported** capability-attachment API so third parties compose plugins in a lean host without the heavy kernel.

### D7 — Repo extraction is a future, trigger-gated phase [new — sequencing]

A standalone `objectql` repo (sibling-link, no publish, the `objectui` model; consumed by both framework and objectbase; carrying `spec`/object-definition root) is the right *destination* but is **gated on a measured trigger**: the cross-package ratio of engine/registry commits (currently **88%**) falling to a low, stable level. Rationale: `objectui` separates cleanly because it is a stable *downstream leaf*; the engine is an *upstream foundation* with 88% cross-cutting churn — separating it now reproduces the maintenance overhead that caused the earlier merge-back. The D1/D2/D3 groundwork makes the eventual extraction mechanical.

## What stays unchanged

- knex remains the SQL backend under `driver-sql`. No driver rewrite. Drivers stay independent packages; multi-backend unchanged.
- `engine.ts` has no dependency on `protocol.ts`; RLS/sharing/permissions remain middleware/hook plugins; the data path is untouched.
- ADR-0066 secure-by-default semantics preserved (and become the *default* profile).

## Feasibility (verified against current source)

| Seam | Status | Evidence |
|---|---|---|
| Engine runs standalone | ✅ | `new ObjectQL()` + `registerDriver` + `registry.registerObject(inline)` = full CRUD, no kernel |
| Core surface separable as subpath | ✅ | `engine.ts` never imports `protocol.ts`; protocol holds only the engine *type* |
| Capabilities detachable | ✅ | `plugin-security`/`plugin-sharing` attach via `ql.registerMiddleware(...)` + hooks; not installing = lean host |
| Splitting protocol saves deps | ❌ | `protocol.ts` adds no third-party/workspace dep; the only external import in engine+registry is `node:async_hooks` |
| Engine API freezable now | ❌ | 88% of engine/registry commits last month were cross-package (see *Decision data*) |
| Profile precedent exists | ✅ | ADR-0066 schema posture cached in `getObjectSecurityMeta()` and enforced in security middleware |

**Conclusion: the lean value is achievable today *additively* (subpath + example) plus discipline (ratchet + capability contract). Physical separation (package or repo) is premature given 88% cross-package churn and a ≈0 dependency win.**

## Worked example

```ts
// Gateway (objectbase) — lean subpath entry, trusted profile, no authz surface
import { ObjectQL } from '@objectstack/objectql/core';
import { MemoryDriver } from '@objectstack/driver-memory';
import { Account } from '@shared/objects/account.object'; // SAME definition as the backend

const engine = new ObjectQL({ profile: 'trusted' }); // explicit, auditable bypass
engine.registerDriver(new MemoryDriver(), true);
await engine.init();
engine.registry.registerObject(Account); // declares RLS — tolerated only under 'trusted'
await engine.find('account', { where: { active: true } });

// Full backend — same object, full capability set, default (fail-closed) profile
import { createObjectQLKernel } from '@objectstack/objectql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingPlugin } from '@objectstack/plugin-sharing';
// boots protocol + security + sharing; Account's RLS is enforced
```

## Phasing

**Now (additive, non-breaking):**
1. **P1 — `./core` subpath export** (`package.json` exports + a `src/core.ts` barrel that omits protocol/plugin/kernel).
2. **P2 — Boundary ratchet** test (core must not import protocol/plugin/kernel) + an export-surface ratchet for the core barrel.
3. **P3 — Capability/profile contract** (plugins `provides`; derive required caps; boot-time validator; `profile` flag; default fail-closed; prod env-gates `trusted`). *The only substantial new code.*
4. **P4 — Standalone embed example + smoke** under `examples/`.

**Later (trigger-gated, D7):** extract standalone `objectql` repo when the cross-package commit ratio drops.

## Consequences

- **+** Gateway unblocked; one library, one object model; safe optional permissions; the boundary that prevents future sprawl is enforced — all without a breaking change.
- **+** Entirely additive now; reversible; keeps atomic cross-package commits while the engine is still co-evolving.
- **−** Subpath + ratchet are weaker isolation than a package boundary (a ratchet can be mis-configured). Accepted deliberately: the package/repo boundary is deferred to D7, not forgone.
- **Risk (highest)**: capability/profile under-specified → silent authz bypass. Mitigation: default fail-closed; `trusted` two-key + prod env-gate; wire into authz-matrix ratchet.
- **Risk**: core-barrel drift (something pulls protocol into the core entry). Mitigation: P2 ratchets.

## Open questions (with recommended positions)

1. **Naming** — resolved by D1: no `-core` package; the lean entry is the `@objectstack/objectql/core` **subpath**; `@objectstack/objectql` stays canonical (npm norm: `react`/`react-dom`).
2. **Capability granularity** — *derive* from object declarations (do not overload per-user `requiredPermissions` for per-deployment host capability); keep an optional deployment-level explicit override as fallback.
3. **`trusted` profile** — two-key: build-time plugin absence + explicit runtime assertion; prod env-allowlisted. Never a lone runtime boolean disabling installed enforcement.
4. **Does the gateway need protocol-lite?** — no: compile-time `registry.registerObject(import)` suffices and the registry already lives in the core surface; full protocol (sys_metadata, draft/publish, ownership) stays out of the gateway.
5. **D7 trigger threshold** — what cross-package ratio (currently 88%) and over what window signals "stable enough to extract"? To be set when first reviewed; track the metric in CI.
