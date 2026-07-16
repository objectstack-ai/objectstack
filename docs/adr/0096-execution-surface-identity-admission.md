# ADR-0096: Execution-Surface Identity Admission — no data-engine call without an explicit principal or an explicit, audited elevation

**Status**: Proposed (2026-07-15)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove gate; stage by whether the feature exists), [ADR-0056](./0056-permission-model-landing-verification.md) D10 (authz conformance matrix — the durable-encoding idiom this ADR extends), [ADR-0066](./0066-unified-authorization-model.md) (capability gate; action `requiredPermissions`), [ADR-0073](./0073-automation-execution-identity.md) (`runAs` as authorization **posture** — `user` / `automation` / `system`; no anonymous run; M2 gated on the first real consumer), [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) (the admission-test idiom, at the kind level), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) D10 (agent ceiling∩user intersection), [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) (layered authz kernel)
**Consumers**: `@objectstack/objectql` (engine call contract), `@objectstack/runtime` (action/facade dispatch, MCP bridge), `@objectstack/plugin-security` (the empty-principal seam), `@objectstack/service-automation`, trigger packages, `@objectstack/dogfood` (conformance matrix + meta-test), every future package that adds an execution surface
**Tracking**: framework#2849 (the trigger instance; its Phase 2/3 become applications of this mechanism)

**Premise**: pre-launch (ADR-0049 idiom) — specify the end-state invariant now, land only the non-speculative slice, and gate every runtime phase on evidence (audit telemetry), not on dates.

> **Trigger**: #2849 (fixed in #2964 at the invoke-time boundary) found that business-action bodies dispatch through an engine facade whose `insert/update/delete/find` carry **no `ExecutionContext`**. A context-less call hits the SecurityPlugin's empty-principal skip and runs with **ambient full authority** — no RLS, no FLS, no CRUD, no tenant scoping, no ADR-0090 D10 agent intersection. #2308 had already found the *same shape* on schedule-triggered flows (`runAs:'user'` with no user → UNSCOPED). Two independent surfaces, one root cause. A subsequent four-axis sweep (see **Evidence**) confirmed the class is broadly populated — a replicated fall-open predicate, several trusted-implicit surfaces (three confirmed exploitable: #2980, #2981, #2982), and structural middleware-bypass paths. This ADR is about the class, not the instances.

---

## TL;DR

Today the platform's data-security middleware **fails open on missing identity**: a call that carries no positions, no permission sets, and no `userId` skips every check. That was a deliberate auth-layering choice, but it has a structural consequence: **every new execution surface that forgets to thread the caller's context silently becomes a privilege-escalation primitive** — no error, no failing test, nothing until an adversarial review finds it (#2308, #2849). As the metadata platform grows surfaces (action bodies, flows, triggers, AI tools, scheduled jobs, import pipelines, custom endpoints), the number of chances to re-introduce this hole grows with it.

This ADR inverts the default with one invariant and four mechanisms:

> **The invariant (D1)**: every data-engine invocation carries either a **real principal** (`ExecutionContext`) or an **explicit, reasoned, audited system grant**. "No context" is a *defect*, never an *authorization*.

1. **D2 — One elevation door**: a single typed constructor (`systemContext(reason)`) becomes the only sanctioned way to run elevated. Elevation becomes grep-able, reasoned, and audited — never ambient.
2. **D3 — The compiler enforces threading**: engine entry points take a **required** identity argument (`ExecutionContext | SystemGrant`). Forgetting to pass context stops being a silent fall-open and becomes a compile error.
3. **D4 — Execution-surface admission test**: the ADR-0088 idiom applied to *surfaces* instead of *kinds*. A surface that can reach the data engine earns admission only by declaring its identity posture (ADR-0073 vocabulary), registering in the authz conformance matrix with an enforcement site, and passing strict-mode CI. A meta-test fails CI on unregistered surfaces.
4. **D5 — Strict mode, staged to fail-closed**: a mode that *denies* non-system context-less calls — ON in CI/dogfood first to surface every violator, default-ON at a major once telemetry says the migration is done.

**Also decided (D6)**: action-level `runAs` (the #2849 Phase 2/3 plan) adopts ADR-0073's three-posture vocabulary (`user` / `automation` / `system`) — not a private two-value enum — and lands as the first *application* of this mechanism, sequenced **after** D2/D3 exist.

**Rejected**: keep trusted-by-default and rely on review vigilance; big-bang context threading (#2849 option b); per-surface bespoke fixes; DB-native SECURITY DEFINER roles. See Alternatives.

---

## Context

### The failure class, precisely

The SecurityPlugin's find/write middleware contains this seam (`plugin-security/src/security-plugin.ts`, the empty-principal skip):

```ts
// Skip security checks if no positions AND no explicit permission sets
// AND no userId (anonymous/unauthenticated). The auth middleware
// should handle authentication separately.
if (positions.length === 0 && explicitPermissionSets.length === 0 && !opCtx.context?.userId) {
  return next();
}
```

The comment states the original intent: *authentication* is the auth layer's job, so an identity-less call is presumed to be internal plumbing. That presumption made sense when the kernel had two callers (REST with auth, boot with `isSystem`). It stops being safe the moment the platform multiplies **metadata-driven execution surfaces** — places where *authored artifacts* (not platform code) cause engine calls:

| Surface | Identity story today | How we learned |
|:---|:---|:---|
| REST / MCP object CRUD | caller's `ExecutionContext`, threaded | by design |
| Business-action `script`/`body` | **none** — facade drops context → fall-open | #2849 (adversarial review) |
| Flow (`runAs:'user'`, user-less trigger) | none → fall-open, warned | #2308 (adversarial review) |
| Flow (`runAs:'system'`) | explicit elevation | ADR-0049/#1888, by design |
| Record-change / schedule triggers | threaded (after #1888 fixes) | bug class, then fixed |
| Boot / seeding / internal jobs | `{ isSystem: true }` literals, scattered | by design, unaudited |

The pattern is exact: **every row that says "adversarial review" is a place where an engineer forgot an optional parameter and the type system, the tests, and the runtime all stayed silent.** The two rows found so far were found by *humans doing security reviews*. Nothing structural prevents the next surface — an import pipeline, a webhook handler, the next AI tool family — from re-adding the same hole, because:

1. The engine accepts context-lessness (optional parameter — nothing to forget *loudly*).
2. The security layer rewards context-lessness with full authority (fall-open).
3. No registry knows which surfaces exist, so no test can enumerate what to check.

ADR-0049's principle ("spec must not declare security properties the runtime does not enforce") has a runtime sibling that this ADR names: **the runtime must not grant authority that no one explicitly requested.** The #2845 claim ("a `data:read` agent's action writes are blocked at the write") was exactly an ADR-0049 violation born from this seam — a security property everyone *believed* held, that nothing enforced.

### Why the fall-open is load-bearing (and why we can't just delete it)

Boot, seeding, migrations, and several internal services legitimately run without a human principal. Today some use explicit `{ isSystem: true }`; an unknown number ride the fall-open instead (that unknown-ness is itself the problem). Deleting the skip outright would fail-closed legitimate system operations at boot — the platform wouldn't start. So the inversion must be **staged**: first make explicit elevation *available and cheap* (D2), then make implicit context *impossible to forget* (D3), then measure what still hits the seam (audit, landed in #2964 for actions), and only then flip the seam itself (D5).

### Relationship to ADR-0073

ADR-0073 answered the **identity** question for user-less *automation* runs: there is no anonymous run; `runAs` declares posture (`user` / `automation` / `system`); attribution is always concrete. It deliberately built almost nothing (M2 gated on the first real consumer). This ADR is the **engine-boundary** complement: 0073 says *what identity a run has*; 0096 says *the engine refuses to move without one*. The two compose: once D2/D3 exist, ADR-0073's postures become the values that flow through the required parameter, and action-level `runAs` (D6) becomes a candidate "first real consumer" that un-gates 0073's M2 — that call is made in 0073's terms when D6 lands, not pre-empted here.

---

## Decisions

### D1 — The invariant: identity or explicit grant, never absence

Every invocation of the data engine (`IDataEngine` / ObjectQL find, insert, update, delete, executeAction, and any future verb) MUST carry exactly one of:

- a **principal-bearing `ExecutionContext`** — a human, an agent (with the ADR-0090 D10 intersection), or the environment's automation principal (ADR-0073); or
- an **explicit `SystemGrant`** — a value that can only be produced by the D2 constructor, carrying a mandatory reason.

A call carrying neither is a **defect**. The runtime's job is to make that defect: (a) impossible to write in first-party TypeScript (D3), (b) visible when it happens anyway — dynamic call sites, JS consumers, legacy paths (audit + D5 strict mode), and (c) eventually fatal (D5 default flip).

This is Prime Directive #10 ("never declare what the platform does not deliver") read in the mirror: **never deliver what nobody declared.**

### D2 — One elevation door: `systemContext(reason)`

A single typed constructor in the engine's contract package:

```ts
// The ONLY sanctioned way to run elevated. `reason` is mandatory,
// machine-greppable, and lands in the audit stream on every use.
function systemContext(reason: SystemReason): SystemGrant;
// SystemReason examples: 'boot:seed-permission-sets', 'action:convert_lead:trusted-body',
// 'migration:2026-07-backfill', 'trigger:schedule:runAs-system'
```

Rules:

1. **`SystemGrant` is unforgeable in practice**: a branded type whose constructor lives in one module. Ad-hoc `{ isSystem: true }` object literals at call sites are retired by lint + migration; the security layer keeps honoring the wire-level `isSystem` flag during transition but the *authoring* path is the constructor.
2. **`reason` is not optional and not free-form-empty.** A namespaced string (`area:detail`) so audit queries can aggregate ("show me every elevation by the action subsystem this week").
3. **Every construction is audit-logged** at use (extending the #2964 audit events from the action facades to all elevation).
4. **Consequence for review**: "list all elevation points" becomes `grep systemContext(` — the property ADR-0056 D10 gave the permission model ("a CHECKED artifact, not a one-time scan"), extended to elevation.

### D3 — The compiler enforces threading: required identity parameter

The engine's public entry points change from *context-optional* to *identity-required*:

```ts
// Before (today) — forgetting `options.context` compiles, runs, and falls open:
find(object: string, options?: QueryOptions): Promise<Row[]>;

// After — the identity is a first-class required argument:
find(object: string, identity: CallIdentity, options?: QueryOptions): Promise<Row[]>;
// CallIdentity = ExecutionContext | SystemGrant
```

Staging (this is a wide but mechanical change):

- **Additive first**: introduce the identity-required signatures alongside the existing ones (new names or overloads), migrate first-party call sites package-by-package, with the D5 strict-mode CI proving each package clean as it converts.
- **Lint bridge**: until the old signatures are removed, an ESLint rule flags context-less calls to the legacy entry points (same idiom as the #2308 `flow-schedule-runas-unscoped` lint).
- **Major**: remove the legacy signatures. From then on the #2849 facade bug is *unwritable* — `buildActionEngineFacade` could not have compiled without deciding, visibly, whose authority it was using.

D3 is what turns D1 from a policy into a property. Reviews catch instances; types remove the class.

### D4 — Execution-surface admission test (the ADR-0088 idiom, one level up)

ADR-0088 defined an admission test for metadata *kinds*; ADR-0085 §2 for authored *keys*. This ADR defines one for **execution surfaces** — any code path through which an authored artifact or external caller causes data-engine calls (today: REST/MCP CRUD, business actions, flows, triggers, scheduled jobs; tomorrow: import pipelines, webhooks, new AI tool families).

A surface earns admission only if ALL three hold:

1. **Declared posture.** The surface documents which ADR-0073 postures it can run under (`user` / `automation` / `system`), what selects the posture (author metadata like `runAs`, caller identity, or fixed), and what its *default* is. "Trusted, always" is an admissible answer — but it must be *written down and gated* (as #2964 did for actions: trusted body, therefore `ai.exposed` + capability gate at invoke time).
2. **Conformance registration.** One row per surface in the authz conformance matrix (`dogfood/test/authz-conformance.matrix.ts`, extending the ADR-0056 D10 structure with a `surface` category): its enforcement site, its posture declaration, and — for surfaces reachable by agents or external callers — a dogfood proof exercising the boundary.
3. **Strict-mode clean.** The surface's test suite passes with D5 strict mode ON: every engine call it makes carries identity or an explicit grant.

**The meta-test**: a conformance test enumerates engine-reaching surfaces (mechanically: the modules invoking the identity-required entry points from D3, plus a maintained allowlist during transition) and **fails CI if a surface is not registered**. This is the piece that protects the *future*: the next engineer adding a surface gets a red build with a checklist, not a silent fall-open and an adversarial-review finding two months later.

The **Evidence** section below enumerates the surfaces found by the initial sweep — those become the matrix's seed rows in their honest current states (BOUNDED / TRUSTED-EXPLICIT / TRUSTED-IMPLICIT / UNKNOWN).

### D5 — Strict mode: fail-closed, staged by evidence

A kernel-level mode (`security.identityStrict`):

- **OFF (today's behavior)**: empty-principal calls skip checks; the #2964 audit events record them.
- **ON**: a non-`SystemGrant`, principal-less engine call is **denied** (`PermissionDeniedError`), same fail-closed posture as the permission-resolution-failure path that already exists in the security plugin.

Rollout is gated on evidence, not dates (ADR-0049/0073 idiom):

1. **Now**: ON in the dogfood suite and CI for packages already migrated to D3 signatures. Every red test is a real finding — either a missing thread (fix: pass the caller) or a legitimate elevation (fix: `systemContext(reason)`).
2. **Telemetry gate**: the audit stream (landed for actions in #2964, extended by D2 to all elevation) answers "how many distinct call sites still hit the fall-open in real deployments, and which reasons dominate?" — the same question #2849's Phase-3 plan needed answered before flipping action defaults.
3. **Major**: default ON. The empty-principal skip in `security-plugin.ts` keeps exactly one behavior: honoring `SystemGrant`/`isSystem`. Anonymous-but-authenticated-elsewhere flows must arrive with a principal by then (they already should — REST's `enforceAuth` is upstream).

### D6 — Action-level `runAs` is an application of this mechanism, in ADR-0073's vocabulary

#2849's Phase 2/3 (give business actions a `runAs`, eventually default bounded) is **confirmed as direction but re-sequenced and re-based**:

1. **Vocabulary**: actions adopt ADR-0073's posture enum — `runAs?: 'user' | 'automation' | 'system'` — not a private two-value flavor. A trusted action body is `runAs:'system'`; the safe middle (`automation`: RLS-enforced against the automation principal's grants) becomes available to actions the moment ADR-0073 M2 seeds the principal.
2. **Sequencing**: D6 lands **after** D2/D3 reach the action facades, because "run the body as the caller" *is* "thread `CallIdentity` through the facade" — building it before the identity-required signatures exist would hand-roll exactly the plumbing D3 makes universal.
3. **Transitional default**: `'system'` (today's behavior, now explicit), with the authoring lint from #2849 Phase 2 (`ai.exposed:true` + `runAs:'system'` ⇒ warn: you are handing AI a trusted body). The default flip to a bounded posture is a candidate for the same major as D5's flip, decided on the same telemetry.
4. **Agent semantics**: when an action runs `runAs:'user'` and the caller is an agent, the threaded context is the ADR-0090 D10 **ceiling∩user** intersection — the honest version of the #2845 claim, delivered by construction instead of asserted by documentation.

---

## Evidence: the class, enumerated

The invariant above is not motivated by a single bug. A four-axis sweep of every data-engine-reaching path (context-less calls, elevation literals, fall-open seams, execution-surface identity) found the class is already populated — **two instances were previously found by adversarial review; the sweep found the rest sitting in the open.** This is the concrete case for a *mechanism* over per-surface patches, and it seeds the D4 matrix. Instances are grouped by how they relate to the invariant.

### E1 — Missing-identity fall-open (the #2849 predicate, replicated)

All trace to the same `positions==0 && permissions==0 && !userId → skip` predicate; fixing #2849 at one site does **not** close the others.

| Site | Surface | Note |
|:---|:---|:---|
| `plugin-security/security-plugin.ts:626` | find/write middleware | the original seam (#2849) |
| `plugin-security/security-plugin.ts:1689` | `getReadFilter` (analytics / reports / raw-SQL RLS compile) | returns `undefined` = *no filter*; the analytics mirror of :626 |
| `objectql/engine.ts` Layer-0 + `driver-sql` `applyTenantScope` (opt-in on `tenantId`) | tenant scoping | Layer-0 is computed **after** the :626 skip, and the driver scope is opt-in → a principal-less context gets **no tenant filter at either layer** (cross-tenant read/write) |
| `rest/rest-server.ts:4317` (+ lookup `:4744`) | guest / public-form routes | bypass `enforceAuth`; fall open when `guest_portal` unregistered (partly mitigated by the `publicFormGrant`) |
| `runtime/http-dispatcher.ts:4231,4236,4240` | custom `object_operation` API endpoints | **accidental** — `callData` invoked with no `executionContext` (every sibling threads it) |
| `runtime/sandbox/body-runner.ts:155` | authored action/hook **body** interior facade | the inside of #2849 — only the *invoke* is gated (#2964); the body's `api.object().find/insert/...` run context-less |
| `mcp/mcp-server-runtime.ts:335` | MCP resource `…/records/{id}` | record read with no session identity |
| `service-messaging/messaging-service.ts` (+ recipient resolver) | notification read/write + recipient-role lookup | unscoped reads of `sys_notification*` and `sys_user`/`sys_member` |
| minor: `http-dispatcher.ts:1322` (env-member), `plugin-webhooks/auto-enqueuer.ts:175`, `objectql/engine.ts:722` (`visibleWhen`) | system plumbing | rely on the *implicit* fall-open; should carry an **explicit** grant so they survive the D5 flip |

### E2 — Trusted-implicit surfaces (ignore the caller / fall back to system) — confirmed exploitable, spun out

| Instance | Verdict | Issue |
|:---|:---|:---|
| Reports `getReport`/`deleteReport`/`listReports` discard the caller and query with `SYSTEM_CTX`; routes only `enforceAuth` → cross-user/cross-tenant IDOR (read+delete any report) | CONFIRMED exploitable | #2980 |
| Scheduled reports (`report-service.ts:425` `dispatchDue`) run `executeReport(..., {isSystem:true})` → a member-owned schedule emails the target object's **entire** table, RLS bypassed | CONFIRMED exploitable | #2980 |
| Knowledge/RAG `applyPermissionFilter` (`knowledge-service.ts:312`) returns **all** hits when `ctx` is missing/system; `chatWithTools`'s `ToolExecutionContext.actor` is optional with a system fallback → agent retrieval escapes the data ceiling | CONFIRMED (framework); exposure gated on cloud impl | #2981 |

These are *not* the :626 fall-open (they use an unconditional `SYSTEM_CTX`), but they are exactly what a D4 conformance row (`caller-scoped?` proof) + the D2 audit would have flagged. Fixed independently of the mechanism, tracked as the mechanism's motivating evidence.

### E3 — Structural: paths that never enter the security middleware (Class B)

| Site | Note |
|:---|:---|
| `objectql/engine.ts:641` `executeAction` | handler invoked **directly**, not via `executeWithMiddleware` — an action touching the driver gets no RLS/FLS/CRUD/tenant |
| `objectql/engine.ts:2793` `engine.execute()` / `driver-sql:1371` `driver.execute()` | raw SQL, documented tenant-bypass; caller trusted to inline the filter |
| `objectql/engine.ts:2956/2991` `getDriverByName`/`getDriverForObject` | hand out the raw driver — middleware-free read/write |
| bulk `update({multi:true})`/`deleteMany` on pure-OWD `private` objects (`sharing-plugin.ts:391`, `security-plugin.ts:821`) | single-id owner check not applied to multi-writes → members modify peers' rows | (#2982)

### E4 — Unknown seams (identity not visibly threaded — investigate, then register)

`runtime/http-dispatcher.ts:1488` **GraphQL** (passes only `{request}`, not the resolved `ec`); `service-realtime` **websocket** delivery (no per-subscriber RLS re-check); attachment **blob-level** RLS; the `chatWithTools` contract's optional actor. Each becomes a D4 matrix row in state `experimental`/`UNKNOWN` with a follow-up.

### E5 — The D2 migration is large but has a prototype

~300 elevation call sites resolve to ~50 hand-rolled `SYSTEM_CTX`/`isSystem` constructors across ~25 files (heaviest: `plugin-approvals` ~64, `plugin-security` ~58, `plugin-sharing` ~52, `plugin-auth` ~44 with 13 in one file). **None are audited today.** The canonical shape already exists — `service-automation/runtime-identity.ts` `resolveRunDataContext` (the sole `runAs:'system'→context` mapper) — which `systemContext(reason)` generalizes. This sizes D2 honestly: a mechanical but wide migration, front-loaded on four packages.

---

## What lands now (the non-speculative slice)

Per ADR-0049's staging discipline, v1 of this ADR builds only what has a consumer today:

1. **This decision record** — the invariant, the admission test, the staging plan.
2. **`systemContext(reason)` + `SystemGrant`** in the engine contract package, with audit emission; migrate the *known* elevation literals (boot/seeding, the action facades' trusted dispatch, report scheduler's `SYSTEM_CTX`) as the proof-of-idiom.
3. **Matrix rows** for the surfaces the Evidence section enumerated, in their *honest current states* — actions register as `trusted-body, gated at invoke (ai.exposed + capability)` per #2964 — plus the meta-test skeleton with the transition allowlist.
4. **The authoring lint** from D6.3 (`ai.exposed` + trusted body ⇒ warn).

The confirmed-exploitable instances the sweep surfaced (E2) are **not** waiting on this mechanism — they are fixed independently and tracked at #2980 (reports IDOR + scheduled-report RLS bypass), #2981 (knowledge/RAG retrieval fall-open), #2982 (bulk-write OWD gap). Their existence is this ADR's motivating evidence, not its deliverable.

Everything else — the D3 signature migration, strict-mode-ON-in-CI per package, the D5 default flip, D6's `runAs` field — is explicitly **M2+, gated on the prior step's evidence**, tracked as separate issues under #2849.

---

## Alternatives considered

**A1 — Keep trusted-by-default; rely on review vigilance + documentation.** This is the do-nothing baseline, and #2308/#2849 are its track record: two independent fall-opens found by *adversarial reviews*, not by any structural control. Review vigilance does not scale with surface count; the platform's core promise (metadata a business can trust AI to operate — see the repo's own description) makes "we document that it's unbounded" a non-answer. Rejected.

**A2 — Big-bang context threading (#2849 option b).** Thread the caller's context through every facade now, no `runAs`, no staging. Correct end-state for *bounded* surfaces, but it breaks every action legitimately relying on trusted cross-object writes (convert-lead, cascade-close), conflates two decisions (the engine contract vs. each surface's default posture), and — without D2 — leaves no sanctioned way to elevate, so trusted logic would reinvent `{ isSystem: true }` scatter. Rejected as a single step; its substance arrives as D3 + per-surface posture decisions.

**A3 — Per-surface bespoke fixes.** Fix actions with an action-shaped patch (#2849 Phase 2/3 as originally scoped), flows with a flow-shaped lint (#2308), the next surface with the next patch. Treats symptoms serially; the class remains open, and each fix hand-rolls its own identity plumbing. Rejected — this ADR exists precisely because the third instance of this bug should be a compile error, not a third review finding.

**A4 — Database-native enforcement (Postgres RLS + SECURITY DEFINER-style per-surface roles).** Push the invariant into the DB so even a buggy engine can't fall open. Same shape as ADR-0095's rejected Postgres-native Layer-0 backstop, same verdict: the platform is DB-portable by contract, the engine boundary is where every driver converges, and a DB-level twin of the posture model would be a second implementation to keep in lock-step. Not scheduled; D5's strict mode delivers the fail-closed property at the portable boundary.

---

## Consequences

**Positive**
- The #2849/#2308 bug class becomes structurally unwritable (D3) instead of review-detectable; the next execution surface gets a red CI checklist (D4) instead of a silent escalation path.
- Elevation becomes enumerable (`grep systemContext(`), reasoned, and audited — security reviews audit a list, not a codebase.
- ADR-0073's posture model gets its engine-side enforcement and a concrete first consumer path (D6); the #2845-style gap between claimed and enforced security properties is closed at the layer that generates such gaps.
- #2849's Phase 2/3 stop being a bespoke action project and become the worked example of a platform mechanism.

**Negative / costs**
- A wide (if mechanical) signature migration (D3) touching every engine call site, spread across a major cycle; transition period carries dual signatures + lint noise.
- The admission test adds real friction to shipping a new surface — one matrix row, one posture paragraph, one strict-mode-clean suite. This is the point, but it is a tax, and PRIORITIZATION review should treat matrix-row PRs as cheap to approve.
- The fall-open seam must keep working (for `SystemGrant`) forever; the invariant's honesty depends on the D2 constructor remaining the *only* producer — a lint + module-boundary discipline, not a cryptographic guarantee.

**Explicitly unchanged**
- The trusted-action model itself: an author may still ship a `runAs:'system'` body; it is now explicit, gated (for AI, by `ai.exposed` per #2964), reasoned, and audited — not abolished.
- ADR-0073's M2 gating: this ADR does not force the automation principal into existence; it defines the contract that will carry it.
- The auth layer's ownership of *authentication*; this ADR governs *authorization at the engine boundary* only.

---

## References

- framework#2849 — the trigger instance (action bodies context-less); its comment thread contains the option analysis this ADR generalizes; Phases 2/3 re-based onto D6
- framework#2964 — the landed invoke-time hardening (ai.exposed gate, flow context forwarding, trusted-dispatch audit) — v1's audit substrate
- framework#2308 / #1888 — the flow instance of the same class; the lint idiom D3/D6 reuse
- framework#2845 / #2843 — the agent action surface whose safety framing this ADR makes true by construction
- framework#2980 / #2981 / #2982 — the confirmed-exploitable instances the Evidence sweep surfaced (reports IDOR + scheduled-report RLS bypass; knowledge/RAG retrieval fall-open; bulk-write OWD gap) — fixed independently; this ADR's motivating evidence
- `packages/plugins/plugin-security/src/security-plugin.ts` — the empty-principal seam (`:626` middleware, `:1689` getReadFilter) (D5's target)
- `packages/runtime/src/http-dispatcher.ts` — `buildActionEngineFacade` (both facades), `invokeBusinessAction`
- `packages/qa/dogfood/test/authz-conformance.matrix.ts` — the ADR-0056 D10 matrix D4 extends
