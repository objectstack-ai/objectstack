# ADR-0025: `@objectstack/metadata-authoring` — Staged Authoring & Package Publish

**Status**: Proposed (2026-06-01)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type, org overlay), [ADR-0008](./0008-metadata-repository-and-change-log.md) (Repository · ChangeLog · Cache · Registry; the four write surfaces), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (Studio authoring → bind → distribute loop — **this ADR revives its §2 draft-workspace north-star**)
**Consumers**: `@objectstack/rest` (HTTP `/meta/*` + `/packages/*` routes), `@objectstack/objectql` (provides the storage + schema-sync adapters), `@objectstack/runtime` (wires the service at kernel bootstrap, owns env activation), `@objectstack/cli` (`os package publish`), `../objectui` (Studio — the visual editor)

---

## TL;DR

Authoring metadata is **not** one operation — it is two, on two cadences:

- **Stage** (high-frequency, cheap, zero runtime impact): every visual edit
  accumulates as a *draft* in a workspace bound to a **package version under
  development**. No DDL runs. The live system is untouched.
- **Publish** (low-frequency, batched, transactional): the whole draft package
  version is validated as a set, its schema migration plan is computed and
  previewed, the **physical DDL runs once for the batch**, the version is
  **sealed** (immutable, semver + checksum), and the environment's **active
  version pointer is swapped** — atomically activating everything and
  invalidating the registry once. Rollback = swap the pointer back.

A first design draft of this ADR modelled a single `commit(change)` that
persisted *and* ran DDL *and* hot-activated on **every edit**. That is an
anti-pattern for a low-code platform — no mainstream system `ALTER TABLE`s the
production database on each canvas click (see §Context). This revision splits it
into **`stage()` + `publish()`** and makes the **package version** — not a
person's env-local overlay rows — the unit of work.

**Decision:** ship `@objectstack/metadata-authoring`, a server-side,
**transport-agnostic** package that owns both phases. It invents no storage and
no protocol; it depends only on `@objectstack/spec` + `@objectstack/metadata-core`
and reaches storage/DDL/activation through injected **ports** whose adapters live
in `objectql`/`runtime`. Any surface (Studio, REST, CLI, AI agent, Git webhook)
drives the *same* stage/publish code path — the ADR-0008 "four write surfaces"
goal, with a single owner.

---

## Context

### How mainstream low-code / metadata platforms handle this

Twenty years of consensus across the vendors ADR-0008 already cites:

| System | Edit sandbox (where drafts live) | Staging unit | Publish action | Physical schema (DDL) timing | Rollback |
|:-------|:---------------------------------|:-------------|:---------------|:-----------------------------|:---------|
| **Salesforce** | Sandbox / Scratch Org | Change Set / **Unlocked Package version** | Metadata API *Deploy* / install package | **At deploy**, validated then activated | Re-deploy prior version; destructive (drop field) is manual |
| **ServiceNow** | Dev instance + **Update Set** | Update Set (scoped app) | Commit / move Update Set; App Repo publish | At commit | "Back out" the Update Set |
| **Mendix** | Working copy + Team Server (Git-like) | Model revision / branch | **Deploy** builds a package, runs DB sync | **At deploy** (auto migration) | Redeploy prior package; forward-only migrations |
| **OutSystems** | Service Studio module | Module version | **1-Click Publish**; LifeTime promotes Dev→QA→Prod | **At publish** (compile + schema upgrade) | Revert to prior published version |
| **Hasura** | Console dev mode | Migration files + metadata | `apply` migrations + metadata to an env | **Explicit migration step** (up/down) | `down` migrations |
| **Retool / Budibase** | Edit / draft mode | App version | Release a version | Data-app oriented, weak DDL | Roll back to a version |

**The shared pattern — what this ADR adopts:**

1. **Editing ≠ committing.** Edits accumulate in a **sandbox workspace** with
   zero impact on the running system.
2. **The publish unit is a package *version*** — immutable, semver'd, validated
   as a whole — not a person's scattered overlay rows.
3. **DDL / data migration runs *at publish*, batched**, with a **diff/preview**
   of the whole migration plan beforehand.
4. **Activation is a pointer swap**: publish atomically switches the installed
   version and invalidates the cache once; rollback swaps the pointer back.
5. **Multi-environment promotion** (Dev/Sandbox preview → Production) uses the
   same machinery.

This is, notably, **ObjectStack's own ADR-0016 §2 north-star** ("draft
`sys_package_version` = authoring workspace → one-click publish seals it"). The
§9 MVP took a local-first shortcut (flat `package_id` binding, edits written as
*live* overlay rows). ADR-0025 formalizes the staged path the §9 note explicitly
reserved for "the cloud phase".

### "Persist to the database" is two layers — and they happen at different times

| Layer | Meaning | Cadence in this model | Today's location |
|:------|:--------|:----------------------|:-----------------|
| **L1 — definition persistence** | Store the JSON definition of object/view/field/app | **Stage** writes drafts; **Publish** seals them | `objectql/sys-metadata-repository.ts`, `metadata/loaders/database-loader.ts` |
| **L2 — physical schema (DDL)** | Create/alter the *real business table* | **Publish only**, batched for the whole package | `objectql/engine.ts → driver.syncSchema()` → `ISchemaDriver` (`createCollection/addColumn/modifyColumn/dropColumn`) |

The earlier draft ran L2 on every edit. Here L2 is deferred to publish and
planned/previewed as a set — matching Salesforce deploy, Mendix/OutSystems
publish, and Hasura migrations.

---

## Decision

Introduce `packages/metadata-authoring` — `@objectstack/metadata-authoring` — a
transport-agnostic package owning two phases.

### Phase A — Stage (draft authoring)

- **Unit:** a **draft package version** = the authoring workspace. A package has
  at most one active `draft` `sys_package_version` per org (ADR-0003 already
  defines `status ∈ {draft, published, deprecated}`; ADR-0016 §2.1 already
  modelled this). Studio's `active_package` selector designates the authoring
  target.
- **`stage(change)`** validates the *single* item (Zod from `spec`) + L1/L2/L3
  protection + `allowOrgOverride`, then writes the definition into the draft
  workspace — `sys_metadata` rows tagged `package_version_id = <draft.id>`.
- **No DDL. No live activation. No production registry mutation.** Optimistic
  concurrency is enforced *within the draft* (per-row `checksum`).
- Supports **discard** (revert a single staged item), **diff** (draft vs. the
  currently-active version), and optional **sandbox preview** (a dev env installs
  the draft with `allowDraft`, ADR-0003/0016 §2.3 — never auto-promoted to prod).
- When **"no package"** is selected, the ADR-0016 §9 behavior holds: a NULL-package
  env-local overlay (`provenance='runtime'`) — personal customization, not a
  shippable artifact. (This is the only path that bypasses staging.)

### Phase B — Publish (deploy)

`publish(packageRef, { targetEnv })`:

1. **Validate the set** — cross-references resolve, no dangling refs, the draft
   is internally consistent (not just each row in isolation).
2. **Plan the migration** — `diff(draft, activeVersion)` → an ordered list of
   `SchemaChange` (DDL) + data backfills. Powers dry-run.
3. **Preview** — `publish(..., { dryRun: true })` returns the plan
   ("will add column `contact.phone TEXT`", "will drop `contact.fax` —
   destructive") without executing.
4. **Execute L2 DDL** for the whole package, batched (prefer
   `driver.syncSchemasBatch` where supported), with the schema-ahead recovery
   rule (§Atomicity). `schemaMode: 'external'` skips L2.
5. **Seal** the draft → `published` `sys_package_version` (freeze
   `manifest_json`, compute checksum, assign immutable semver — ADR-0016 §2.4).
6. **Swap the active pointer** — upsert `sys_package_installation` for `targetEnv`
   to the new `package_version_id`. **This is the activation**: one atomic
   pointer move, one registry invalidation + ChangeLog event.
7. **Open a fresh `draft`** for continued authoring (next version).

**Rollback** = swap the installation pointer back to a prior sealed version
(+ a reverse/compensating migration when schema changed — forward-only by
default, as Mendix/Rails; destructive reversals are surfaced, not auto-run).

### Public API

```ts
// ── Phase A: stage ───────────────────────────────────────────────
interface StageChange {
  op: 'put' | 'delete';
  type: string;            // 'object' | 'view' | 'field' | ...
  name: string;
  item?: unknown;
  orgId: string;
  packageRef: PackageRef;  // the draft workspace this binds to
  actor?: string;
  parentVersion?: string;  // OCC within the draft (maps from If-Match)
}
interface StageResult { ref; draftVersion: string; warnings: string[]; }

// ── Phase B: publish ─────────────────────────────────────────────
interface SchemaChange {
  kind: 'create_table'|'add_column'|'modify_column'|'drop_column'|'create_index'|'drop_index';
  table: string; detail: string; destructive: boolean;
}
interface MigrationPlan { changes: SchemaChange[]; backfills: string[]; destructive: boolean; }
interface PublishResult {
  packageVersionId: string; semver: string;
  plan: MigrationPlan; activatedEnv: string; changeLogSeq: number;
}

class MetadataAuthoringService {
  // staging
  stage(change: StageChange): Promise<StageResult>;
  discard(ref: MetaRef, packageRef: PackageRef): Promise<void>;
  diff(packageRef: PackageRef): Promise<MigrationPlan>;       // draft vs active

  // publishing
  publish(packageRef: PackageRef, opts: { targetEnv: string; dryRun?: boolean; force?: boolean }): Promise<PublishResult>;
  rollback(packageRef: PackageRef, toVersionId: string, opts: { targetEnv: string }): Promise<PublishResult>;
}
```

### Ports (dependency inversion — how the cycle is broken)

The service depends on **interfaces**, not on `objectql`. Adapters implementing
these ports live in `objectql`/`runtime` and are injected at kernel bootstrap.

```ts
interface DraftWorkspacePort   { get; put; delete; list; diffAgainstActive; }  // draft-scoped sys_metadata
interface PackageVersionPort   { openDraft; seal; getActive; }                 // sys_package_version lifecycle
interface InstallationPort     { activate(env, versionId); current(env); }     // sys_package_installation pointer swap
interface SchemaSyncPort       { plan(objs, prev): SchemaChange[]; apply(changes, tx): Promise<void>; } // ISchemaDriver
interface ChangeLogPort        { append(event): Promise<number>; }
interface RegistryPort         { invalidate(ref): void; broadcast(event): void; }
interface TransactionPort      { run<T>(fn): Promise<T>; }                      // engine.transaction()
```

### Dependency graph (must stay acyclic)

```
spec  (contracts / Zod)
  ▲ ▲ ▲
  │ │ └──── metadata-authoring ──┐  depends: spec, metadata-core, PORTS only
  │ │                             │  (NOT objectql / runtime directly)
  │ └── objectql ──(impl ports)───┤  DraftWorkspace / SchemaSync / Tx adapters
  │     runtime  ──(impl ports)───┘  PackageVersion / Installation (env activation)
  └── metadata-core (Repository iface / ChangeLog / canonicalize / errors)
        ▲
rest → metadata-authoring          rest only translates HTTP ⇄ stage()/publish()
cli  → metadata-authoring          `os package publish` hits the same publish()
```

### Atomicity strategy (publish only)

L1 (sealing definitions) is transactional. **L2 (DDL) frequently is not** —
MySQL implicit-commits DDL, Postgres is partially transactional, Mongo/Memory
have none. So publish does **not** fake a single rollback:

1. **Plan** all schema changes (also powers dry-run).
2. **Apply DDL first**, batched. On failure: nothing was sealed/activated; abort.
3. **Then seal + swap the pointer + changelog** inside `TransactionPort.run()`.
   If *this* fails after DDL succeeded, the schema is "ahead" of any activated
   version: emit a `schema-ahead` repair event/warning rather than fake a DDL
   rollback. Idempotent `syncSchemas` reconciles on the next publish/boot.

Because activation is a **pointer swap**, a failed publish leaves the previously
active version serving traffic untouched — the running app never sees a
half-applied package.

---

## Consequences

### Positive

- **Editing is free and safe**: staging never touches production schema or the
  live registry — matching every mainstream platform's sandbox model.
- **Publish is a reviewable, batched, atomic unit** with a previewable migration
  plan and pointer-swap activation/rollback.
- **The package version is the unit of work**, so changes are shippable,
  versioned, and promotable across environments — not trapped as personal
  overlay rows.
- **One stage/publish path for all surfaces** (Studio, REST, CLI, AI, Git) — the
  ADR-0008 goal, single owner. `os package publish` and the Studio button hit
  the same `publish()` (ADR-0016 CLI-parity goal).
- Revives ADR-0016 §2 without re-modelling — §9's local export/import still works
  as the no-cloud distribution of a sealed version.

### Negative / risks

- More moving parts than the §9 MVP: a draft-version workspace, a diff/plan
  engine, and pointer-swap activation.
- The destructive-reversal side of rollback (un-dropping a column) is genuinely
  hard; default is forward-only with surfaced compensations (industry norm).
- Per-driver migration/rollback integration tests needed (sql, sqlite-wasm,
  mongodb, memory).
- Reconciling the §9 flat `package_id` rows already in the wild with
  `package_version_id`-bound drafts needs a migration (treat existing
  `package_id` rows as the package's seed/published baseline).

### Migration plan (incremental, each phase ships green)

- **Phase 0** — New empty package; define `ports.ts`, `StageChange`,
  `PublishResult`, `MigrationPlan`. Zero behavior change.
- **Phase 1** — Implement `stage()` over a `DraftWorkspacePort` adapter backed by
  `package_version_id`-tagged `sys_metadata`. Studio `save` routes to `stage()`;
  no DDL, no activation. Existing live-overlay path stays for "no package".
- **Phase 2** — Implement the diff/plan engine + `publish()` (seal + batched DDL +
  pointer-swap activation + changelog). Wire `os package publish` and the Studio
  publish button to it.
- **Phase 3** — `rollback()`, dry-run preview UI, destructive-change gating,
  schema-ahead recovery hardening across drivers.
- **Phase 4** — Migrate existing §9 `package_id` rows to the version-bound model;
  update `ARCHITECTURE.md`; mark this ADR `Accepted`.

---

## Alternatives considered

- **Per-edit `commit` (the first draft).** Rejected: `ALTER TABLE` on every
  canvas edit is an anti-pattern; no staging, no reviewable unit, dangerous on
  production data.
- **Keep §9's flat live-overlay binding as the only model.** Rejected: edits are
  immediately live and tied to env/person, so there is no draft to review and no
  shippable, versioned unit — the user's two objections.
- **L1-only package** (persist definitions; leave DDL to boot-time `syncSchemas`).
  Rejected: the no-code loop needs publish to *also* materialize schema, planned
  and previewed as a set.
- **Fold into `objectql` or `rest`.** Rejected: couples the authoring lifecycle to
  the data engine or to HTTP, blocking four-surface reuse (CLI/AI/Git).
