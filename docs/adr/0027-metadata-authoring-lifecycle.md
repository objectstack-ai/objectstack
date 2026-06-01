# ADR-0027: `@objectstack/metadata-authoring` — Staged Authoring, Publish & Promotion Lifecycle

**Status**: Proposed (2026-06-01)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0002](./0002-environment-database-isolation.md) (per-environment database), [ADR-0003](./0003-package-as-first-class-citizen.md) (package · version · installation), [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type, org overlay), [ADR-0006 v4](./0006-project-environment-split.v4.md) (unify on package, drop project), [ADR-0008](./0008-metadata-repository-and-change-log.md) (Repository · ChangeLog · Cache · Registry; four write surfaces), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (Studio authoring loop — **this ADR revives its §2 draft-workspace north-star**), [ADR-0019](./0019-approval-as-flow-node.md) (approvals)
**Related (boundary)**: [ADR-0025](./0025-plugin-package-distribution.md) (plugin package distribution — code + dependencies) and [ADR-0026](./0026-client-ui-plugin-distribution.md) (client-side UI plugin distribution) own **how a *sealed* package is distributed and installed**; ADR-0027 owns **how a package is authored, staged, sealed, and promoted across environments**. The two meet at the sealed `sys_package_version` artifact: this ADR produces it, those ADRs ship it.
**Consumers**: `@objectstack/rest` (HTTP `/meta/*` + `/api/v1/cloud/packages/*` routes), `@objectstack/objectql` (storage + schema-sync + destructive-check adapters), `@objectstack/runtime` (kernel bootstrap; owns env activation / install-pointer swap), `@objectstack/cli` (`os package publish`), `@objectstack/plugins/plugin-approvals` (publish gate), `../objectui` (Studio)

---

## TL;DR

Authoring a metadata-driven app is a **multi-stage business process**, not a
single write. This ADR defines that process and the package that owns it:

```
open draft → stage edits → validate+diff → sandbox preview
   → publish (seal + batch-migrate + activate)
   → promote Dev→Staging→Prod (approval-gated)
   → rollback / deprecate / distribute
```

Two cadences underpin it:

- **Stage** — high-frequency, cheap, **zero runtime/DDL impact**. Each visual
  edit accumulates as a *draft* bound to a **package version under development**.
- **Publish** — low-frequency, batched, transactional. The whole draft is
  validated as a set, its migration plan computed and previewed, the **physical
  DDL runs once**, the version is **sealed** (immutable, semver + checksum), and
  the target environment's **install pointer is swapped** — activating
  atomically.

**Key finding from the codebase:** the *data model* for all of this already
exists (`sys_package`, `sys_package_version{status: draft|published|deprecated}`,
`sys_package_installation{packageVersionId, status}`, `sys_environment`,
`sys_metadata{state, package_version_id}`), and destructive-change detection
already exists in `objectql`. **What is missing is the orchestration** — a single
owner that sequences stage → diff → publish → promote → rollback across these
tables. `@objectstack/metadata-authoring` is that owner: server-side,
transport-agnostic, depending only on `spec` + `metadata-core`, reaching
storage/DDL/activation through injected **ports** (adapters in
`objectql`/`runtime`). Every surface — Studio, REST, CLI, AI agent, Git webhook —
drives the same lifecycle.

---

## Context

### How mainstream low-code / metadata platforms handle this

| System | Edit sandbox | Staging unit | Publish action | DDL timing | Promotion | Rollback |
|:--|:--|:--|:--|:--|:--|:--|
| **Salesforce** | Sandbox / Scratch Org | Change Set / **Unlocked Package version** | Metadata API *Deploy* / install | **At deploy** | Sandbox→Prod change set | Re-deploy prior version; drop-field manual |
| **ServiceNow** | Dev instance + **Update Set** | Update Set (scoped app) | Commit / move Update Set | At commit | Dev→Test→Prod instances | "Back out" the Update Set |
| **Mendix** | Working copy + Team Server | Model revision / branch | **Deploy** builds package, runs DB sync | **At deploy** | Dev→Acc→Prod | Redeploy prior; forward-only |
| **OutSystems** | Service Studio module | Module version | **1-Click Publish** | **At publish** | LifeTime Dev→QA→Prod | Revert to prior version |
| **Hasura** | Console dev mode | Migration files + metadata | `apply` to an env | **Explicit migration** | per-env apply | `down` migrations |

**Consensus this ADR adopts:** editing ≠ committing; the publish unit is an
immutable **package version**; DDL runs **at publish**, batched and previewable;
activation is a **pointer swap**; promotion across environments reuses the same
machinery; rollback swaps the pointer back.

### What already exists in ObjectStack (we orchestrate, not invent)

| Capability | Where | Notes |
|:--|:--|:--|
| Package identity | `spec/src/cloud/package.zod.ts` | `manifestId`, `visibility ∈ {private,org,marketplace}`, `publisher` |
| Versioned snapshot | `spec/src/cloud/package-version.zod.ts` | `version` (semver), **`status ∈ {draft,published,deprecated}`**, `manifestJson`, `checksum`, `dependencies[{packageId,versionRange,optional}]`, `minPlatformVersion`, `isPreRelease` |
| Env install pointer | `spec/src/cloud/environment-package.zod.ts` | **`packageVersionId`** (the pointer), `status ∈ {installed,installing,upgrading,disabled,error}`, `enabled`, `withSampleData` |
| Environment | `spec/src/cloud/environment.zod.ts` | per-env DB (ADR-0002); type ∈ {production,sandbox,development,test,staging,preview,trial} (advisory); members ∈ {owner,admin,maker,reader,guest} |
| Metadata row | `platform-objects/.../sys-metadata.object.ts` | **`state ∈ {draft,active,archived,deprecated}`**, `package_version_id` FK, `managed_by`, `scope` |
| Destructive detection | `objectql/.../protocol-destructive.test.ts` | `field_removed`, `field_type_change`, `field_required_no_default`; `force` bypass |
| Schema DDL | `driver-sql` `ISchemaDriver` | `createCollection/addColumn/modifyColumn/dropColumn`, `syncSchemasBatch` |
| Publish endpoints | `cli/.../package/publish.ts` | `POST /api/v1/cloud/packages` → `/versions` → install; `allowDraft` for dev/sandbox |
| Approvals | `plugin-approvals` | `sys_approval_request/action` — exists, **not yet wired to publish** |

The §9 MVP of ADR-0016 took a shortcut: edits write *live* `sys_metadata`
overlay rows bound to a flat `package_id`, immediately active. This ADR revives
§2's north-star — drafts bound to a **draft version**, sealed on publish.

---

## The complete development lifecycle

### Actors & roles (from `EnvironmentRole`)

| Role | Can stage | Can publish (seal) | Can promote to prod | Can rollback |
|:--|:-:|:-:|:-:|:-:|
| `maker` | ✓ | ✓ (to dev/sandbox) | — (requests approval) | — |
| `admin` | ✓ | ✓ | ✓ | ✓ |
| `owner` | ✓ | ✓ | ✓ | ✓ |
| `reader`/`guest` | — | — | — | — |

### End-to-end flow

```
 ┌── DEV ENVIRONMENT (type: development) ─────────────────────────────┐
 │                                                                     │
 │  (A) openDraft(pkg)  ── draft sys_package_version{status:draft}     │
 │        │                                                            │
 │  (B) stage(change) ×N ── sys_metadata{state:draft,                  │
 │        │                   package_version_id=draft.id}  (no DDL)   │
 │        │                                                            │
 │  (C) diff()/validate() ── plan = draft vs active; set-validation    │
 │        │                                                            │
 │  (D) preview ── install draft into dev env (allowDraft=true)        │
 │        │           sys_package_installation.packageVersionId=draft  │
 │        ▼                                                            │
 │  (E) publish(pkg,{targetEnv:dev})                                   │
 │        1 validate set   2 plan migration   3 dry-run preview        │
 │        4 batch DDL      5 SEAL → status:published, semver, checksum │
 │        6 swap install pointer (activate)  7 open next draft         │
 └────────────────────────────────┬────────────────────────────────--┘
                                   │  (F) promote (approval-gated)
                                   ▼
 ┌── STAGING (type: staging) ─────────────────────────────────────────┐
 │  install the SAME sealed version → run its migration → activate     │
 └────────────────────────────────┬────────────────────────────────--┘
                                   │  (F) promote (approval-gated, admin)
                                   ▼
 ┌── PRODUCTION (type: production) ───────────────────────────────────┐
 │  install the SAME sealed version → migration (destructive-gated)    │
 │  (G) rollback = swap pointer back to prior published version        │
 └─────────────────────────────────────────────────────────────────--┘
```

**The unit that flows between environments is the sealed `sys_package_version`,
never raw rows** — identical to Salesforce package versions / OutSystems module
versions.

### Package-version state machine

```
        openDraft                publish(seal)              deprecate
  ∅ ───────────────▶ draft ───────────────────▶ published ───────────▶ deprecated
                      │ ▲                          │  ▲
        stage/discard │ └── open next draft ───────┘  │ rollback target
                      ▼          (after publish)      │ (pointer swaps here)
                   (mutable)                     (immutable)
```

- **draft** — mutable; only dev/sandbox may install it (`allowDraft`). Holds the
  staged `sys_metadata{state:draft, package_version_id=draft.id}` rows.
- **published** — immutable (frozen `manifestJson` + `checksum` + semver);
  installable into any environment. This is the promotion/rollback unit.
- **deprecated** — published-but-discouraged; blocks new installs unless
  `allowDeprecated`.

Installation status (`installing → upgrading → installed | error | disabled`)
tracks the per-environment apply; activation succeeds only when the pointer swap
+ migration complete.

---

## Decision

Ship `packages/metadata-authoring` (`@objectstack/metadata-authoring`) — the
transport-agnostic owner of the lifecycle above.

### 1. Scope & boundary

**In:** orchestration of `openDraft / stage / discard / diff / validate /
preview / publish / promote / rollback / deprecate`; the migration-plan (diff)
engine; the publish-time DDL batching + activation sequencing; approval-gate
invocation.

**Out (depended on, never re-implemented):** Zod schemas (`spec`); storage
(`objectql` `SysMetadataRepository`, the `sys_*` objects); DDL execution
(`driver-*` `ISchemaDriver`); env DB routing & install-pointer persistence
(`runtime`); HTTP (`rest`); the visual editor (`../objectui`).

### 2. Lifecycle phases (detail)

**(A) Open workspace.** `openDraft(pkgRef, orgId)` ensures ≤1 active `draft`
`sys_package_version` per package per org (ADR-0016 §2.1). Idempotent; returns
the draft id all staging binds to.

**(B) Stage.** `stage(change)` runs **per-item** validation only —
Zod (`spec`) + ADR-0010 protection + `allowOrgOverride` whitelist — then writes
`sys_metadata{state:'draft', package_version_id=draft.id}`. **No DDL, no
activation.** OCC is per-row within the draft (`checksum`/`parentVersion`).
`discard(ref)` removes a staged row; "no package" selected ⇒ legacy env-local
overlay path (ADR-0016 §9), the only non-staged route.

**(C) Validate & diff.** `diff(pkgRef)` returns a `MigrationPlan` = the schema
delta between the draft and the **currently-active** sealed version, plus a
**set-level** validation (cross-references resolve, no dangling refs, no
duplicate FQNs) that per-item staging cannot catch.

**(D) Sandbox preview.** Install the draft into a `development`/`sandbox`
environment with `allowDraft=true` (`sys_package_installation.packageVersionId =
draft.id`), so authors run their in-progress package live before sealing. Never
auto-promoted.

**(E) Publish (seal + migrate + activate).** `publish(pkgRef,{targetEnv})`:
1. **Validate the set** (C).
2. **Plan migration** — `diff` → ordered `SchemaChange[]` + `backfills[]`.
3. **Preview** (`dryRun:true`) returns the plan without executing.
4. **Execute L2 DDL**, batched (`syncSchemasBatch`), destructive-gated (§4).
5. **Seal** → `status:'published'`, freeze `manifestJson`, compute `checksum`,
   assign semver; flip the draft's `sys_metadata` rows `state:'draft' → 'active'`.
6. **Swap install pointer** — upsert `sys_package_installation` for `targetEnv`
   to the new `packageVersionId` (status `upgrading → installed`); one registry
   invalidation + one ChangeLog event.
7. **Open next draft** for continued authoring.

**(F) Promote across environments.** Promotion = installing the **same sealed
version** into the next environment up (Dev→Staging→Prod), reusing
`InstallPackageToEnvironment` + the same migration executor. Gated by approval
(§6) and role (`promote-to-production` requires `admin`/`owner`). No re-seal — the
checksum that ran in staging is the checksum that runs in prod (Salesforce/
OutSystems parity).

**(G) Rollback.** Swap `sys_package_installation.packageVersionId` back to a
prior `published` version (atomic pointer move) + run the **reverse migration**.
Reverse DDL is forward-only-with-compensation by default (Mendix/Rails norm):
additive reversals (re-add a column) are auto-generated; destructive reversals
(restore dropped data) are **surfaced, not auto-run**.

**(H) Deprecate & distribute.** `deprecate(versionRef)` flips `status:'deprecated'`
(blocks new installs). Distribution reuses ADR-0016 §9 export/import of a sealed
version (zero-cloud) and the `visibility:'marketplace'` publish path.

### 3. Data-model mapping (no new tables)

| Phase | Object touched | Effect |
|:--|:--|:--|
| A openDraft | `sys_package_version` | insert `{status:'draft'}` |
| B stage | `sys_metadata` | upsert `{state:'draft', package_version_id=draft.id}` |
| C diff | (read) `sys_metadata` + active version | compute plan |
| D preview | `sys_package_installation` | pointer → draft.id (`allowDraft`) |
| E publish | `sys_package_version`, `sys_metadata`, physical tables, `sys_package_installation` | seal + DDL + rows→active + pointer swap |
| F promote | `sys_package_installation` (+ physical tables in target env DB) | install sealed version in next env |
| G rollback | `sys_package_installation` (+ reverse DDL) | pointer → prior version |
| H deprecate | `sys_package_version` | `status:'deprecated'` |

### 4. Migration & data lifecycle (the hard part)

- **MigrationPlan** = `{ changes: SchemaChange[], backfills: string[], destructive: boolean }`,
  computed from the field-level diff of draft vs active object definitions.
- **Reuse existing destructive detection** (`field_removed`,
  `field_type_change`, `field_required_no_default`). Policy by **environment
  type**: destructive changes are **blocked on `production`** unless an explicit
  `force` + approval; allowed on `development`/`sandbox`.
- **Backfill**: `field_required_no_default` requires either a default or a
  backfill expression before the column can be `NOT NULL` — surfaced in the plan.
- **Atomicity (publish only).** DDL is frequently non-transactional (MySQL
  implicit-commit; Mongo/Memory none). So: (1) plan, (2) apply DDL first —
  failure means nothing sealed/activated, abort; (3) seal + pointer swap +
  changelog inside `TransactionPort.run()`. If step 3 fails after DDL, emit a
  `schema-ahead` repair event rather than fake a DDL rollback; idempotent
  `syncSchemas` reconciles. Because activation is a **pointer swap**, a failed
  publish leaves the previously active version serving traffic untouched.
- **Expand-contract (baked into the model now, executed in M4).** A
  `MigrationPlan` is an *ordered* list of steps, not a flat diff, precisely so a
  production change can run the zero-downtime sequence
  `add column → backfill → switch reads → drop old` — possibly spanning two
  sealed versions. M2 ships the naive "apply the diff" executor; the plan shape
  already supports the multi-step form so M4 adds it without re-modelling. This
  is why `MigrationPlan` separates `changes` from `backfills` and carries a
  `destructive` flag rather than being a single DDL string.
- **Per-target-environment execution.** Because each environment has its own
  physical database (ADR-0002), `SchemaSyncPort.apply` and `InstallationPort`
  operate against the **target environment's** engine/driver, not the control
  plane's. The executor is parameterized by `targetEnv` from publish/promote —
  the same sealed `checksum` runs against Dev's DB, then Staging's, then Prod's.

### 5. Concurrency & collaboration

- **One active draft per package per org** (ADR-0016 §2.1) — serializes the
  authoring workspace; avoids divergent drafts in v1 (Git-style branching is a
  non-goal, matching ADR-0016).
- **Per-row OCC** inside the draft (`checksum`/`If-Match`): two makers editing
  *different* objects don't conflict; editing the *same* row raises
  `ConflictError`.
- **Advisory edit locks** (optional, v2): soft-lock a metadata item to a maker
  while open in Studio.

### 6. Governance & approvals

- Wire `plugin-approvals` (`sys_approval_request`) as a **publish/promote gate**:
  `promote(...,{targetEnv:prod})` raises an approval request; the install pointer
  swaps only on approval. Configurable per environment (prod gated, dev open).
- Every transition emits a ChangeLog event (ADR-0008) + `sys_metadata_audit`
  (ADR-0010) row: who staged / sealed / promoted / rolled back, with checksums.

### 7. Public API

```ts
class MetadataAuthoringService {
  // workspace
  openDraft(pkg: PackageRef, orgId: string): Promise<DraftHandle>;

  // stage (Phase B) — no DDL, no activation
  stage(change: StageChange): Promise<StageResult>;
  discard(ref: MetaRef, draft: DraftHandle): Promise<void>;

  // review (Phase C)
  diff(draft: DraftHandle): Promise<MigrationPlan>;
  validateSet(draft: DraftHandle): Promise<ValidationReport>;

  // publish (Phase E) — seal + batch DDL + pointer-swap activate
  publish(draft: DraftHandle, opts: { targetEnv: string; dryRun?: boolean; force?: boolean }): Promise<PublishResult>;

  // promote (Phase F) — same sealed version into next env, approval-gated
  promote(versionId: string, opts: { targetEnv: string; force?: boolean }): Promise<PromoteResult>;

  // rollback / deprecate (Phase G/H)
  rollback(opts: { targetEnv: string; toVersionId: string }): Promise<PromoteResult>;
  deprecate(versionId: string): Promise<void>;
}

interface StageChange { op:'put'|'delete'; type:string; name:string; item?:unknown;
                        orgId:string; draft:DraftHandle; actor?:string; parentVersion?:string }
interface SchemaChange { kind:'create_table'|'add_column'|'modify_column'|'drop_column'|'create_index'|'drop_index';
                         table:string; detail:string; destructive:boolean }
interface MigrationPlan { changes:SchemaChange[]; backfills:string[]; destructive:boolean }
interface PublishResult { packageVersionId:string; semver:string; plan:MigrationPlan;
                          activatedEnv:string; changeLogSeq:number }
```

### 8. Ports & dependency graph

```ts
interface DraftWorkspacePort { get; put; delete; list; }              // draft-scoped sys_metadata
interface PackageVersionPort { openDraft; seal; getActive; deprecate } // sys_package_version lifecycle
interface InstallationPort   { activate(env,versionId); current(env) } // sys_package_installation pointer
interface SchemaSyncPort     { plan(objs,prev):SchemaChange[]; apply(targetEnv,changes,tx) } // per-env ISchemaDriver + destructive check
interface ApprovalPort       { request(kind,ctx):Promise<ApprovalOutcome> }        // plugin-approvals
interface ChangeLogPort      { append(event):Promise<number> }
interface RegistryPort       { invalidate(ref); broadcast(event) }
interface TransactionPort    { run<T>(fn):Promise<T> }                 // engine.transaction()
```

```
spec  (contracts / Zod)
  ▲ ▲ ▲
  │ │ └── metadata-authoring ──┐ depends: spec, metadata-core, PORTS only
  │ │                           │ (NOT objectql / runtime directly)
  │ ├── objectql ──(impl ports)─┤ DraftWorkspace / SchemaSync(+destructive) / Tx
  │ ├── runtime  ──(impl ports)─┤ PackageVersion / Installation / env activation
  │ └── plugin-approvals ───────┘ Approval
  └── metadata-core (Repository iface / ChangeLog / canonicalize / errors)
        ▲
rest → metadata-authoring     HTTP ⇄ lifecycle calls
cli  → metadata-authoring     `os package publish` → publish()/promote()
```

### 9. Atomicity

See §4 — DDL-first, then seal+swap inside a transaction, `schema-ahead`
compensation for the non-transactional gap, pointer-swap activation isolating
in-flight failures from live traffic.

---

## Long-term north star & phased delivery

### The complete capability map (where this is going)

A mature metadata-authoring platform (Salesforce DX / OutSystems / Mendix class)
needs the layers below. ADR-0027 designs *all* of them; the ports, the ordered
`MigrationPlan`, the sealed-version artifact, and per-target-env execution are
**baked in now** so later layers slot in without re-modelling.

| Layer | Long-term capability | First delivered |
|:--|:--|:--|
| **Authoring** | draft workspace · stage/discard · per-item + set validation · live diff | M1 |
| **Migration** | schema diff → plan · dry-run preview · destructive gating · **expand-contract zero-downtime** · data backfill expressions | M2 (naive) → M4 (expand-contract/backfill) |
| **Release** | seal immutable version (semver+checksum) · pointer-swap activation · open next draft | M2 |
| **Environments** | per-env DB execution · Dev→Staging→Prod promotion · ephemeral preview envs | M3 (promotion) → M4 (ephemeral) |
| **Governance** | approval gates · RBAC by role · L1/L2/L3 protection · audit/changelog · prod destructive policy | M3 |
| **Recovery** | rollback (pointer swap + reverse migration) · drift detection / schema-ahead reconcile · post-activate health checks | M3 (rollback) → M4 (drift/health) |
| **Distribution** | local export/import (§9) · marketplace · **dependency resolution** (`versionRange`) · upgrade paths — *mechanics owned by ADR-0025/0026; this ADR only produces the sealed artifact they ship* | §9 exists → M4 |
| **Collaboration** | edit locks · **branch + merge** · multi-author drafts | M5 |
| **Source duality** | DB-backed drafts **and** file/Git authoring seal into the *same* version (ADR-0006 "two flows, one schema") | seal accepts either source from M2 |

**Explicitly deferred (but architecturally provided for):** expand-contract
migrations, Git-style branching/merge, marketplace dependency resolution,
ephemeral preview environments, drift detection. None of these force a redesign
because the artifact (sealed version) and the plan (ordered steps) already carry
the necessary shape.

### Phased delivery roadmap (value-front-loaded, each milestone ships standalone)

**Guiding principles:** (1) every milestone delivers user-visible value on its
own; (2) every milestone is non-breaking and **coexists with the §9 live-overlay
MVP** until M5 retires it; (3) risk is sequenced — read-only/no-DDL first,
production DDL later, collaboration last.

| Milestone | Value delivered (why ship it) | Scope | Risk | Coexistence |
|:--|:--|:--|:--|:--|
| **M0 — Seams** | De-risks everything: stable contracts to build against | empty package, `ports.ts`, `StageChange`/`MigrationPlan`/`PublishResult` types, state-machine doc | none (no behavior change) | n/a |
| **M1 — Staging** | *"Edit safely without touching prod; see exactly what changed."* The single biggest UX/safety win, with **no DDL risk** | `openDraft` + `stage`/`discard` (draft-version-tagged rows); `diff`/`validateSet` + dry-run preview (read-only) | low (no writes to physical schema) | Studio `save`→`stage()`; publish still uses existing path |
| **M2 — Publish** | *"Edit in UI → publish → live."* The closed loop; replaces per-edit live overlay with explicit, batched publish | migration-plan **executor** (naive diff) · seal version · pointer-swap activation · open next draft; wire `os package publish` + Studio publish button | medium (first prod-path DDL) | "no package" overlay path unchanged |
| **M3 — Promote & govern** | *"Safe production rollout."* Enterprise-readiness | `promote` Dev→Staging→Prod (same sealed checksum) · approval gates (`plugin-approvals`) · destructive gating by env type · `rollback` (pointer swap + additive reverse) | medium-high (cross-env, prod policy) | per-env DBs already isolated (ADR-0002) |
| **M4 — Advanced migration & DX** | Zero-downtime prod changes; full surface parity | expand-contract migrations · data backfill expressions · drift detection / health checks · CLI/AI/Git surface parity · marketplace dependency resolution | high (zero-downtime correctness) | additive to M2 executor |
| **M5 — Collaboration** | Multi-author teams | edit locks → branch + merge → concurrent drafts; **retire §9 flat `package_id` rows** (migrate to version-bound) | high (merge semantics) | final consolidation |

**Recommended MVP cut:** **M0 + M1 + M2** is the smallest end-to-end product —
it delivers the whole "edit → stage → preview → publish → live" loop a low-code
user expects, defers all the genuinely hard parts (cross-env promotion,
zero-downtime migration, branching), and never breaks the existing flow. M3
follows immediately for any production/multi-env customer.

## Consequences

### Positive
- A named owner for the **whole** authoring lifecycle; every surface (Studio /
  REST / CLI / AI / Git) drives the same path (ADR-0008 goal; ADR-0016 CLI parity).
- Editing is free and safe; production schema changes are batched, previewed,
  approval-gated, and reversible by pointer swap.
- **Reuses the entire existing data model** — no new tables; the net-new code is
  the orchestration + diff/plan engine.
- Promotion across `development→staging→production` falls out of the same
  install-pointer mechanism + per-environment-type policy.

### Negative / risks
- Significant orchestration surface; the diff/migration-plan engine and the
  reverse-migration path are genuinely hard and need per-driver integration tests
  (sql, sqlite-wasm, mongodb, memory).
- Destructive reversal (un-dropping data) is forward-only-with-compensation;
  true data restore is out of scope (industry norm).
- Reconciling §9 flat-`package_id` rows already in the wild with version-bound
  drafts needs a one-time migration (treat them as the package's published seed).
- "One active draft per package/org" defers multi-branch authoring (accepted v1
  limitation, per ADR-0016 non-goals).

### Gap analysis — exists vs. net-new

| Needed | Status |
|:--|:--|
| package/version/installation/env/metadata schemas | **exists** (`spec/src/cloud/*`, `sys-metadata`) |
| destructive-change detection | **exists** (`objectql`) |
| DDL execution + batch sync | **exists** (`ISchemaDriver`, `syncSchemasBatch`) |
| publish/install REST + CLI | **exists** (`/api/v1/cloud/packages`, `os package publish`) |
| approvals primitive | **exists** (`plugin-approvals`) |
| **draft-version staging binding (stage/discard)** | **net-new** |
| **diff / migration-plan engine + dry-run preview** | **net-new** |
| **publish-time batched DDL + seal + pointer-swap orchestration** | **net-new** |
| **promotion + approval-gate wiring** | **net-new** (primitives exist) |
| **reverse-migration / rollback executor** | **net-new** |

See "## Long-term north star & phased delivery" below.

---

## Alternatives considered
- **Per-edit `commit` (first draft).** Rejected: `ALTER TABLE` on every canvas
  click; no staging, no reviewable unit, dangerous on production data.
- **Keep §9 flat live-overlay binding only.** Rejected: edits immediately live
  and tied to a person/env; no draft to review, no shippable versioned unit.
- **Branch-per-author (Git-style) drafts in v1.** Deferred: one active draft per
  package/org keeps resolution trivial (ADR-0016 non-goal); revisit with merge.
- **Fold into `objectql`/`rest`.** Rejected: couples the lifecycle to the data
  engine or to HTTP, blocking four-surface reuse (CLI/AI/Git).
