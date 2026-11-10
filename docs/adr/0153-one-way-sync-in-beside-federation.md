# ADR-0153: One-way sync-in beside federation — a connector or a federated object, a warehouse table included, fills an ordinary object marked `synced`, read-only to members, written back only through declared actions

**Status**: Proposed (2026-11-10). `docs/adr/` is Tier H (Prime Directive #14): this record becomes **Accepted** by the maintainer's merge or an authorised approval. **This record declares; it implements nothing**: no schema, no code, no changeset. The child cards under [Children the epic files on acceptance](#children-the-epic-files-on-acceptance) are filed by the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763) after acceptance and ⛔ never before it. · **Amends** [ADR-0015](./0015-external-datasource-federation.md) §2.2 by one dated note: its non-goals point mirrors at the retired `DataSync`, and now point here.

- **Date**: 2026-11-10
- **Card**: [#31780](https://github.com/objectstack-ai/objectstack/issues/31780) (p1, `domain:spec`), the P1 child of the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763). Its "Decisions the ADR must take" list, D1–D10 with a default each, is this record's skeleton; where a decision below departs from the card's default, the decision says so and why.
- **Decided by**: the maintainer, 2026-11-09, on the epic, verbatim and untranslated. This record executes the rulings as recorded; ⛔ none is re-opened here.
  - **Letter A** — ruling record [`6731568115`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6731568115): 「立专题卡」 at 03:25Z and 「同意你的意见」 at 03:26Z, taking the analysis's recommendation as a whole: one-way sync-in becomes a platform capability beside federation, scoped to sync-in, a provenance marker and write-back only through declared actions; the sync kernel ships in this repository under Apache-2.0; the existing `mapping` / `job` keys are extended and the `DataSyncConfig` / `ETLPipeline` vocabulary is not revived; no bidirectional sync, no conflict merge, no edits overlay.
  - **Amended** — record [`6731744658`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6731744658): 「Palantir 的核心能力我们都应该要有，不等客户需求」 (03:32Z); 「数据管道与加工（Pipeline Builder 类） 你不是说我们不做吗」 (03:33Z) — pipelines and transforms are not built here, warehouse and ETL vendors are partners, and their warehouses are first-class pull sources. The card's ruling line carries the same turn as 「数据仓库类的公司就是我们的合作伙伴」.
  - **Edition split** — record [`6738924490`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6738924490), 「同意」 at 11:23Z: the open edition holds "**the sync-in kernel** (database-source reader, paging, delete policy, provenance columns, `synced` bucket — this epic)"; record-level lineage is Enterprise and lives in the private repository (cloud#4163). The record [`6732372274`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6732372274) was withdrawn as a ruling by [`6732391136`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6732391136) and is not relied on.
- **Key names** are the `domain:spec` seat's under the maintainer's standing rule; the card's working names stand as this record's proposed spelling.
- **Builds on**: [ADR-0015](./0015-external-datasource-federation.md) (federation, `external_catalog`, the 2026-11-03 organization-scope note), [ADR-0062](./0062-external-datasource-runtime.md) (the datasource connection service a pull reads through), [ADR-0049](./0049-no-unenforced-security-properties.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (declared ⇒ enforced; a rule ships with the runtime line that makes it true), [ADR-0103](./0103-managedby-write-policy-and-engine-write-guard.md) (buckets; the engine write guard, the `apiMethods` reconciliation and the `/me/permissions` clamp, which the 2026-07-20 addendum names as what made a new bucket safe), [ADR-0090](./0090-permission-model-v2-concept-convergence.md) (D1: an unset `sharingModel` is not public, and an authored one is required), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) (no NULL organization; D7 deployment-level state; D9 the refused stamp), [ADR-0073](./0073-automation-execution-identity.md) (execution identity; D3 attribution is not ownership), [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md) (a delete stays physical, the recycle bin is a separate store), [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md) (a connector's credential), [ADR-0057-system-data-lifecycle-and-retention](./0057-system-data-lifecycle-and-retention.md) (retention).
- **Leaves unchanged**: federation as ADR-0015 decides it (a virtual object stays the answer for live, computed or must-not-land data); the import door and its mapping semantics; a connector's actions and the flow `connector_action` node; `job` schedules and the job ledger; every existing bucket's affordances; the retirement entries `etl-pipeline-layer-retired` and `connector-sync-keys-retired`, whose ENFORCE route this record walks rather than reverses.
- **Consumers**: `@objectstack/spec` (`mapping`, `job`, `managedBy`, the injected-columns plan), `@objectstack/objectql` (the windowed read through the external-driver floor and its refusal count, keyset paging on built-in drivers, the purge, the reconciliation, the readonly-strip mirror), `@objectstack/service-automation` (the pull executor), `@objectstack/core` (the import runner, the `/me/permissions` clamp), `@objectstack/runtime` (the job binder, its organization refusal and the runtime job bridge), `@objectstack/plugin-security` (the bucket's write guard), `@objectstack/platform-objects` (the run record), `@objectstack/lint`, `ui/` (the bucket union, the Studio wizard, read-only rendering), `content/docs` and `skills/`.

---

## Provenance

1. **Decision card** (triage, 2026-11-09T03:02Z, kept in the epic body): the maintainer's 「我就是想做 palentir 开源替代方案，立决策卡」, options A / B / C, with A recommended.
2. **Ruling A** `6731568115` and its amendments `6731744658` and `6738924490`, quoted above.
3. **P0 measurement** [#31778](https://github.com/objectstack-ai/objectstack/issues/31778), os-dev report [`6732731853`](https://github.com/objectstack-ai/objectstack/issues/31778#issuecomment-6732731853): the existing pull path (a `rest` connector, `mapping.connectorSource`, `job.pull`) run end to end on a production-mode `os serve` at `c2bb879f`, one reading per gap G1–G9. [Current state](#current-state-g1g9) is written from it and re-read on `origin/main` `c9246279`.
4. **This card**, claimed for `domain:spec#2` in [`6754703995`](https://github.com/objectstack-ai/objectstack/issues/31780#issuecomment-6754703995).

---

## TL;DR

1. **Sync-in is a second way in, beside federation, not a replacement for it.** A remote table or API collection becomes an ordinary object whose rows were **copied** by a pull. Every platform surface (permissions, RLS, reports, datasets, flows, MCP, AI) reads it as it reads any object. Federation stays the answer when a copy would be wrong ([D10](#d10--the-three-way-rule-and-the-partner-stance)).
2. **Two source keys, one binding home.** `mapping.connectorSource` (a `rest` / `openapi` connector) stays; a sibling `mapping.datasourceSource { object, watermark: { field, start }, full? }` makes any federated object a pull source, a warehouse table included; exactly one source per mapping. A built-in driver is read by keyset paging with no cap. A floored plugin driver is read through the engine's external-driver floor, in windows `lo <= field < hi` that are halved when one comes back over the cap. That costs more round trips, needs both bounds pushed down, and lifts nothing in ruling `6487532394`. Snowflake and BigQuery drivers move from the engine child to plugin packages outside this repository, per ruling `6731568115` (a departure from the epic's row) ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)).
3. **A pull reads every page.** A declared `paging { style, param, nextPath }` on the connector source; keyset pages or bounded windows on the datasource source; the starting point of the next pull is the largest watermark value a pull has read and **committed** ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)).
4. **A source delete is marked, never applied.** `deletePolicy: 'mark' | 'ignore'`, default `mark`, stamping `_sync_deleted_at` ([D3](#d3--deletes-mark-or-ignore-never-a-physical-delete)).
5. **`managedBy: 'synced'`** marks the object: read-only to members at every mechanism ADR-0103 guards a bucket with, five platform columns under the reserved `_sync_` prefix, no person owner, and an authored `sharingModel` like any custom object (ADR-0090 D1). A mapping that carries a source must target a `synced` object ([D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns)).
6. **Write-back is a declared action** that calls the source; the next pull brings the change home. No bidirectional sync, no merge, no overlay ([D5](#d5--write-back-only-through-declared-actions)).
7. **Drift refuses the pull**, judged against the federation catalog, the OpenAPI operation's declared response, or the records themselves ([D6](#d6--drift-a-mapped-source-column-that-is-gone-refuses-the-pull)).
8. **One run record per pull**, `sys_sync_run`, organization-owned, beside the job ledger ([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)).
9. **A pull runs as the system, in a declared organization**; under a walled posture a pull job that names none is refused by name, at boot and at the runtime door. This narrows ruling `5974483403` Q2-O1 for the pull form under `group` ([D8](#d8--execution-identity-and-organization)).
10. **Open source, Apache-2.0** (ruled, [D9](#d9--open-source-placement-ruled)). **Transforms are the partners' job**, and the guide says so ([D10](#d10--the-three-way-rule-and-the-partner-stance)).
11. **Studio may create a pull job**, the one job shape a runtime writer can name, once a runtime-stored job is scheduled, which nothing does today ([D11](#d11--the-studio-door-a-runtime-pull-job)).

---

## Context

### Why sync-in, beside federation

Federation (ADR-0015) leaves rows where they live and forwards each query. It is right for live, computed or
must-not-land data, and it has limits by design: no cross-datasource joins (§2.2), no distributed transactions, the
remote system's latency on every read, and a row cap on in-memory evaluation for plugin drivers. Reports, analysis,
AI question answering and joins across sources hit those limits first. Copying the rows into an ordinary object
removes them: the platform then owns the indexes, the query operators, the permissions and the uptime. The maintainer
ruled that copy path a platform capability (A), with the copy one-way and write-back only through declared actions.

A pull path already exists, narrow by design. A `mapping` (`targetObject`, `fieldMapping`, `mode`, `upsertKey`)
gained `connectorSource` when the connector-side `syncConfig` / `fieldMappings` were retired
(`packages/spec/src/migrations/entries/semantic/18.connector-sync-keys-retired.ts`): "A sync is defined on its
TARGET". A `job` whose `pull` names the mapping drives it (`packages/spec/src/system/job.zod.ts#JobSchema`), and
`packages/services/service-automation/src/connector-pull.ts#pullConnectorSource` executes it through the import runner.
The ETL layer before it left because nothing ran it
(`packages/spec/src/migrations/entries/semantic/17.etl-pipeline-layer-retired.ts`); that entry's way back is about
multi-stage pipelines, which this epic rules out. The pull's own route was ruled on #20281
([`5904845660`](https://github.com/objectstack-ai/objectstack/issues/20281#issuecomment-5904845660), letter A: spec,
then service, then job). This record extends the pull that runs; it revives nothing that did not.

### Current state (G1–G9)

The P0 report measured each gap live at `c2bb879f`. Re-read on `origin/main` `c9246279` for this record, five of the
report's out-of-scope findings have since landed on `main` (the validate warning, the blank-key row error, the
failed-pull `warn`, the organization-scoped match and the skipped overlapping tick); the table carries both readings, and the decisions below
are written against `c9246279`.

| # | Gap | P0 reading (`c2bb879f`, report `6732731853`) | On `origin/main` `c9246279` |
|:--|:--|:--|:--|
| G1 | Pull sources | A federated SQLite and Postgres 16 datasource read live (`total: 5`), but naming one as `connectorSource.connector` failed every tick (`not registered`); a `datasourceSource` key was refused as unrecognised | **Holds.** `MappingSchema` carries `connectorSource` alone (`packages/spec/src/data/mapping.zod.ts#MappingSchema`); the executor resolves only providers in `packages/services/service-automation/src/connector-pull.ts#CONNECTOR_PULL_PROVIDERS`. New since P0: `os validate` names a datasource given as the connector (`packages/lint/src/validate-mapping-connector-source.ts#MAPPING_CONNECTOR_SOURCE_UNKNOWN`, a warning) |
| G2 | Paging | One response per pull; a full pull of 250 rows landed 100 on every tick, each run `success` | **Holds.** The executor header: "⛔ One response per pull. The connector's own paging is not followed" |
| G3 | Deletes | A deleted source row stayed local in both modes | **Holds.** The binding refuses `deleteMode` with "there is no delete, conflict or direction policy to set" (`packages/spec/src/data/mapping.zod.ts#CONNECTOR_SOURCE_NO_POLICY`) |
| G4 | Provenance | No source, mapping, run, external key or pulled-at column; `owner_id` NULL, so a `private` target listed 0 of 100 rows to a member with `allowRead` | **Holds.** No bucket and no column carries provenance (`packages/spec/src/data/injected-system-columns.ts#resolveInjectedSystemColumns`) |
| G5 | Read-only gate | A member with `allowEdit` patched a synced row (200); the next pull kept or overwrote the edit by mode, silently | **Holds.** No bucket covers a pulled object; the guard keys on `packages/plugins/plugin-security/src/system-write-guard.ts#ENGINE_OWNED_BUCKETS` |
| G6 | Drift | A dropped mapped column left stale values with no log line; a dropped upsert-key column re-created every changed row with a blank key, run `success` | **Partly closed.** A blank match key is now a row error and the run `degraded` (`packages/services/service-automation/src/connector-pull.ts#refuseBlankMatchKeys`, #31810). A dropped non-key column is still silent |
| G7 | Run record | `sys_job_run` per tick (status, duration, error); no counts, no watermark; a failed pull logged nothing | **Partial.** Counts reach the run only as the `degraded` reason string (`packages/runtime/src/app-artifact-handlers.ts#pullRunOutcomeOf`); a failed pull now logs one `warn` (`pullConnectorSource`). The ledger is deployment-level and platform-only (`packages/platform-objects/src/audit/sys-job-run.object.ts#SysJobRun`) |
| G8 | Studio entry | "Sync objects" on the datasource page drafts federated objects and moves no rows; `PUT /meta/job` → 403 `NOT_CREATABLE` | **Holds.** `ui/packages/app-shell/src/views/metadata-admin/datasource/DatasourceResourcePage.tsx#offersSync`; `job` is `allowRuntimeCreate: false` (`packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY`) |
| G9 | Scale | 100,000 rows in one response took 62 min: each upsert lookup scanned the table (no organization predicate); creates flush in batches of 200; four overlapping runs of one job at a 30 s interval | **Scan and overlap closed.** The match lookup is scoped to the write's organization (`packages/core/src/utils/import-runner.ts#matchScopeOf`); a tick whose previous run is still in flight on the node is skipped (`packages/services/service-job/src/scheduled-fire.ts#skippedTickMessage`). Batches stay `packages/core/src/utils/import-runner.ts#MAX_CREATE_BATCH_SIZE` |

Two measured facts shape the decisions and stay true under them: the pull writes as the system
(`{ isSystem: true, tenantId }`, the executor header), so it bypasses every user-context guard by construction; and a
pulled row carries no person owner, so an owner-scoped sharing model hides it from every member (G4).

---

## Decision

### D1 — Pull sources: a sibling `datasourceSource` beside `connectorSource`

`mapping` gains a sibling of `connectorSource`, proposed spelling:

```ts
datasourceSource: {
  object: 'warehouse_fact_orders',                         // a federated object (ADR-0015) the pull reads
  watermark: { field: 'updated_at', start: '2020-01-01' },  // the field windows are cut on, and the lowest value read
  full: true,                                               // optional — re-read from `start` on every run (D3)
}
```

- **Exactly one source per mapping.** A mapping carrying both `connectorSource` and `datasourceSource` is refused at
  parse; a mapping carrying neither stays the import door's mapping, unchanged.
- **The source is a declared federated object.** The pull reads the rows of a federated object (ADR-0015): an object
  on a datasource whose `schemaMode` is `external` or `validate-only`, bound to its remote table by `object.external`
  (`packages/spec/src/data/object.zod.ts#ObjectExternalBindingSchema`: `remoteName`, `remoteSchema`, `columnMap`). An
  object on a managed datasource is refused as a source: its rows are already local, and a pull would copy rows the
  platform already owns. Reading through a declared object is what keeps the pull inside the platform's existing
  read path:
  - **addressing is federation's own.** The federated binding pass installs the object's remote table, schema and
    column map on the driver (`IDataDriver.registerExternalObject`,
    `packages/spec/src/contracts/data-driver.ts#IDataDriver`), as it does for every federated object. The pull
    writes no driver state of its own. A reader-private binding would not be safe: `SqlDriver.registerExternalObject`
    keeps one entry per physical table, last writer wins (`objectByPhysicalTable`, read by the driver's coercion
    lookup), so a second binding of a table that a federated object already binds would change how that object's reads
    are coerced. The contract has no unregister;
  - **`remoteSchema` and every other binding term come from the object**, so a driver addresses `mart.fact_orders`
    however it addresses that object today, and a driver that cannot address a federated object cannot be a source;
  - **the engine knows the source's field types**, so the floor compares a window's bounds by the field's storage
    rule ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed));
  - **the object's own posture applies, and the pull does not widen it.** The pull reads as the system (D8). A member
    reads the federated object only through a grant on it, and a deployment that wants members to read only the
    copy grants nothing on the source. Under a walled posture the source object states its organization scope like
    any external object (ADR-0015, the 2026-11-03 note).
- **Two read paths, by the driver ruling `6487532394` gives the source.** Q1 = B on #27277 gives the engine's
  correctness floor (`packages/objectql/src/external-driver-floor.ts#createExternalDriverFloor`) to every plugin
  driver on a non-managed datasource that holds no verified-pushdown credential. That set is empty: the credential is
  #27261's P3 and is not built. The same ruling leaves built-in drivers unfloored, because they execute the whole
  query. The pull follows the ruling on both sides and lifts nothing in it
  ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)):
  - **A built-in driver** (Postgres, MySQL, SQLite, Oracle, SQL Server) is read by **keyset paging** on
    (watermark, source key) with no row cap, as `find()`'s contract lets any built-in read page.
  - **A floored plugin driver** is read in **windows bounded on both sides**, each a plain `find` through the floor.
    The floor sends the driver `where`, `orderBy` and `limit` cap + 1, never `offset`, and throws
    `ExternalRowCapExceededError` when more than the cap comes back. The cap defaults to 1,000 and is never above
    `packages/spec/src/data/datasource.zod.ts#EXTERNAL_ROW_CAP_CEILING` (10,000). It sends cap + 1 whatever limit
    the caller asked for, so only a predicate that matches at most the cap can pass. The window's own bounds are
    that predicate.
- **What the windows buy, cost and trust (floored drivers only).**
  - **What they buy.** Correctness under any driver the floor admits, relying on no driver ordering, top-N or
    `offset`. The floor re-applies each window's `where` in memory, and its failure mapping keeps a remote's raw
    error off the wire and off the run record (D7 stores the floor's refusal, not the driver's message).
  - **What they cost.** More round trips on a large table. A window that comes back over the cap is read again,
    halved, and the rows of a refused read are transferred and discarded. **The pull needs both bounds pushed
    down.** A driver that pushes only the lower bound (an "updated since" parameter, the usual API-backed shape)
    returns every row above `lo` to every window, and halving `hi` changes nothing. A driver that pushes only the
    upper bound fails the same way once the rows at or below `hi` pass the cap. A driver that pushes neither
    returns the whole table. Each of these is refused under its own name, `sync_bounds_not_pushed`, kept apart
    from one value holding more rows than the cap
    ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)).
  - **What they trust.** What the floor trusts: an answer at or under the cap is the whole set the window matches. A
    driver that silently returns fewer matching rows than exist (a remote that pages below the cap and says
    nothing) is no more visible to the pull than to a federated read.
- **Warehouses: a departure from the epic's P2 engine row.** That row reads "datasource-as-source reader incl.
  Snowflake / BigQuery dialects". Amendment `6731744658` makes a warehouse a first-class pull source, and ruling
  `6731568115`, which this record executes, reads: "Vendor-specific drivers and connectors stay out of this
  repository (#27261 P2 ruling)". The #27261 close-out
  [`6523503305`](https://github.com/objectstack-ai/objectstack/issues/27261#issuecomment-6523503305) names "vendor
  drivers such as Salesforce and SAP v2". This record follows the ruling over the epic's row:
  - a warehouse is a first-class source through whatever driver serves its dialect, and the windowed read makes it
    pullable at any size;
  - the repository already spells a warehouse driver as a plugin. `com.vendor.snowflake` is the driver vocabulary's
    own example of a plugin-contributed driver, and `DRIVER_VOCABULARY` names no warehouse id
    (`packages/spec/src/data/driver/config-registry.zod.ts#BUILTIN_DRIVER_IDS`). The engine child owes no vendor
    dialect;
  - Snowflake and BigQuery drivers go to a child of their own, **P3 — warehouse drivers**: plugin packages outside
    this repository, per `6731568115`, verified by the conformance kit
    (`packages/objectql/src/plugin-driver-conformance.ts#definePluginDriverConformanceSuite`) with the windowed-read
    cases the engine child adds. Who builds them, a partner or this project in a separate repository, is the
    maintainer's call when the epic files that child.

  The SQL driver's federated dialects (ADR-0015 §4.6: Postgres, MySQL, SQLite, and the federation-only Oracle and SQL
  Server) serve as pull sources as soon as the engine child lands.
- **`job.pull` widens to either source.** `defineStack` today refuses a pull whose mapping declares no
  `connectorSource` (`packages/spec/src/stack.zod.ts#collectJobPullMappingErrors`); it accepts either source.

*Why a sibling, not one `source` union (the card's alternative).* `connectorSource` is a published, live key. Folding
it into a union renames it for every author for no new capability; a sibling adds one optional key and leaves every
existing binding as it is. ⛔ Not a new metadata type: the sync stays defined on its target, the `mapping`.

*Departure from the card's default:* the card's working names `{ datasource, remoteName, watermark? }` become
`{ object, watermark: { field, start }, full? }`. The datasource, the remote table and its schema are the federated
object's binding, spelled once, as ADR-0015 spells them. A declared object is the addressing that touches no shared
driver state, and it gives the floor the field types it compares by. `watermark` is required, because the windows are
cut on it ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)).

### D2 — Paging: every page is read, the watermark advances only when committed

**Connector source.** `connectorSource` gains a declared paging convention:

```ts
paging: { style: 'page' | 'cursor' | 'offset' | 'none', param: 'page', nextPath: 'body.next' }
```

- `page` sends `param` = 1, 2, …; `offset` sends `param` = the count of records read so far; `cursor` sends `param`
  = the value read at `nextPath` in the previous response. `nextPath` is required for `cursor` and optional for the
  other two, where it names the response's "more pages" marker; without it a pull stops at the first page that
  carries no records.
- `none` sends nothing and states that **one response is the whole set**: the source does not page. It is the one
  way to say that a single response is complete, and D3's full-pull mark needs it said.
- A cursor that repeats the previous one refuses the pull (`paging_cursor_repeated`) rather than looping.
- With no `paging`, a pull keeps today's one-response reading, the `watermark` describe keeps saying so, and the
  platform does not treat that response as complete ([D3](#d3--deletes-mark-or-ignore-never-a-physical-delete)).

**Datasource source: the watermark field.** `watermark.field` is a `datetime` field, a `date` field, or a `number`
field that declares `scale: 0`, the build's reading of an integer. Any other type is refused at build. The field must
**only grow** at the source: a row's value is set when the row is written and never set lower
([D3](#d3--deletes-mark-or-ignore-never-a-physical-delete) says what a backward move does). A row whose watermark is
NULL is in no read. It is counted on every run (`skipped_null_watermark: N` on the run record,
[D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)) and never skipped silently.

**On a built-in driver: keyset paging, no cap.** The pull reads pages of `watermark.field >= from`, ordered by
(watermark, source key). Each page starts strictly after the last (watermark, key) pair read, with `limit` set to the
import runner's batch (`packages/core/src/utils/import-runner.ts#MAX_CREATE_BATCH_SIZE`). The read ends on the
first short page. A built-in driver executes `where`, `orderBy` and `limit` as `find()`'s contract requires, so the
pair is an exact position within a run. Nothing caps the read: `external.rowCap` is refused on a built-in driver by
the datasource schema ("never capped"), and the pull asks for no cap there.

**On a floored plugin driver: windows bounded on both sides.** The pull reads its source object in windows of
`watermark.field`, each **`lo <= field < hi`**, each a plain `find` through the floor ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)):

- **The shape, and why it is this one.** Every bound is aligned to the engine's temporal canon: a whole millisecond
  for `datetime`, a calendar day for `date`, a whole number for the integer field. The floor compares a `datetime`
  in its storage form (`packages/core/src/utils/temporal-storage-form.ts`: `Date#toISOString`, millisecond
  precision), so it reads a source value finer than a millisecond truncated. A remote that stores microseconds
  (Postgres, BigQuery, Snowflake) evaluates the pushed `where` at its own precision. Under truncation `lo <= field <
  hi` on aligned bounds is consistent: a value is at or above an aligned `lo`, or below an aligned `hi`, exactly
  when its truncation is. So the remote and the floor put every row in the same window. `lo < field <= hi` is not
  consistent. A row at `lo` + 0.3 ms is in the remote's window above `lo`, the floor reads it as `lo` and drops it,
  and no window keeps it. The conformance cases the engine child adds include a source row finer than a millisecond.
- **The first window** starts at the read position: the committed position on an incremental run
  (`field >= committed`), else `watermark.start`. The engine child sets the first width and how it grows; the record
  fixes only the rule.
- **On `ExternalRowCapExceededError`, two cases, each with its own name.** The floor's refusal carries how many of
  the rows the driver returned match the sent `where` in memory. The engine child adds that count to the error and
  changes nothing in what the floor admits.
  - **Every returned row matches.** The window really holds more than the cap, so it is halved (`hi` moves to the
    aligned midpoint) and read again. A window one step wide that still holds more than the cap refuses the pull as
    **`sync_window_unsplittable`**, naming the value and the cap. One value holds more rows than the cap. The
    remedies are that datasource's `external.rowCap` (at most 10,000; the schema allows it on a plugin driver) or a
    finer window field. A compound window (the watermark, then a second field) is open for the engine child.
  - **Some returned rows fall outside the window.** The driver did not push both bounds, and halving cannot help.
    The pull refuses as **`sync_bounds_not_pushed`**, naming the datasource
    ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)).
- **A window under the cap is the whole set it matches.** Its rows are written through the import runner in the
  runner's own batches, and the next window starts at its `hi`. The windows tile the range with no gap and no
  overlap.
- **The end.** After a window answers under the cap, the pull may read the window open above, `field >= lo`. When
  that answers under the cap, the pull has read everything from `lo` up, and it ends. How often the probe is tried is
  the engine child's choice; each failed probe costs one refused read.
- **How a bound is compared.** The `where` is pushed to the driver, and the floor re-evaluates it in memory by the
  source field's declared class (`packages/objectql/src/driver-query-in-memory.ts#applyDriverQueryInMemory`). No
  ordering of the driver's answer is read or checked, so no collation enters.
- **The batch size is the cap.** A window holds at most the datasource's resolved row cap
  (`packages/objectql/src/external-driver-errors.ts#resolveExternalRowCap`). An operator who lowers `external.rowCap`
  to keep federated reads narrow also narrows the pull's windows. That costs round trips, not correctness.

**The starting point is a committed position, never above a value the pull has read.** Today's starting point is
the highest value already written to the target (the executor's W1 read). It becomes the position a pull has
**committed**, stored on the run record ([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)):

- **the committed position is the largest watermark value the run has read**: the largest value in a row the pull
  wrote. It is never a window's `hi` and never a page boundary the source has not reached. A bounded window can end
  above the source's present maximum and still answer under the cap. Committing its `hi` would pass rows the source
  writes later below that `hi`, and those rows would never be read. The open-above window commits the same largest
  value read. A run that reads no row leaves the position where it was;
- **ties are read again.** The next incremental pull starts at `field >= committed`, so rows that share the
  committed value, including rows written to it after the pull, are read again. The keyed upsert (`upsertKey`,
  [D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns)) makes a second read of a row harmless;
- a **datasource source** commits after each window, or each page, is written, so an interrupted pull resumes from
  its last commit;
- a **connector source** cannot see the source's order, so it commits once, after its last page. An interrupted
  connector pull re-reads from the previous commit, and the upsert makes the re-read idempotent. This closes the
  newest-first loss the `watermark` describe warns about.

*Departure from the card's default:* "the watermark is committed per batch" holds for the datasource source only,
per window or page. Committing per page on a source whose order the platform cannot see would advance past pages it
never read.

### D3 — Deletes: mark or ignore, never a physical delete

Each source block gains `deletePolicy: 'mark' | 'ignore'`. Absent, it reads as `mark`. The schema declares no
`.default()`, so an authored value stays distinguishable from an absent one, which its liveness row needs
([Children](#children-the-epic-files-on-acceptance)).

- **`mark`** stamps the platform column `_sync_deleted_at` ([D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns))
  on a row the source no longer has, and clears it if the row comes back. Two detections:
  - a **full** pull (a connector source with no `watermark`, or a datasource source with `full: true`) marks every
    row of this mapping that a completed pull did not read, **only when the read is complete on the terms below**:
    - a datasource source is complete when its read reached the end from `watermark.start`
      ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)): on a built-in driver its last
      page came back short; on a floored driver every window up to and including the window open above answered
      under the cap. The floored case rests on the floor's own trust, that an answer at or under the cap is the whole
      set it matches, and on nothing more;
    - **what a mark may judge.** A datasource pull marks only target rows its read could have read: rows of this
      mapping whose watermark value is non-NULL and at or above `watermark.start`. A change of `start` or of
      `watermark.field` therefore marks nothing outside the new range. Rows below a raised `start` stay as they were,
      and are no longer refreshed;
    - **NULL watermarks.** A run whose `skipped_null_watermark` count is not zero marks nothing
      (`deletes: unjudged, null watermark`). A source row whose watermark became NULL would otherwise read as absent.
      On a floored driver the count is a read of `field IS NULL` through the floor, and a count above the cap is
      recorded as more than the cap;
    - **a watermark that moved backwards.** The windows of a floored read are read at different times. A row whose
      watermark is set lower during the run can move from a window not yet read into one already read, and be marked.
      That is why the field must only grow (D2). If it does not, the mark is wrong for one run and is cleared on the
      next full pull that reads the row, since `mark` clears a row that comes back. An incremental pull never reads a
      row that moved below the committed position;
    - a connector source is complete only when it declares `paging` ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)),
      `none` included, and the pull read to its last page. A full connector pull with no `paging` marks nothing, and
      its run record says so (`deletes: unjudged, no paging declared`): P0 measured a paged endpoint read as one
      response (100 of 250 rows, every run `success`), and marking from that read would mark every row past page one;
    - an interrupted or refused pull marks nothing;
  - an **incremental** pull cannot see an absence, so it reads a source soft-delete field: `deletedField`, a source
    field whose truthy value means the row was deleted at the source.
- **An incremental source that cannot see deletes refuses at build.** An incremental source with `deletePolicy`
  absent or `'mark'` and no `deletedField` declares a policy no runtime line could honour (ADR-0078): the author
  states `deletedField` or `deletePolicy: 'ignore'`. The refusal lands with the reader that marks, in the P2 engine
  child, so that between the two PRs no author is made to write a key that still warns it is not read.
- **`ignore`** leaves the row as it is.
- **No `delete` value in this record.** A pull never deletes a row physically.

*Why a mark, and why ADR-0148 does not forbid it.* ADR-0148 D1 refused an `IsDeleted` / `deleted_at` column for a
member's delete, because a deleted row must vanish from every read path and "the first path that forgets shows
deleted rows". A sync mark promises no vanishing: the row stays a live row on every path, and `_sync_deleted_at` is a
fact about the source, read and filtered the way any field is. A physical delete by an unattended job would instead
drop rows that local records reference, on the source's word alone, before the recycle bin exists to restore them.
When ADR-0148's recycle bin ships, a `delete` value that routes through the engine's delete (and so through the bin)
is a decision of its own record.

### D4 — Provenance: the `synced` bucket and the `_sync_` columns

**Object level: a new bucket, `managedBy: 'synced'`.**

- Default affordances: `create`, `import`, `edit` and `delete` false, `exportCsv` true — the `engine-owned` row
  (`packages/spec/src/data/object.zod.ts#resolveCrudAffordances`).
- **`userActions` may not open a write verb on a `synced` object.** No member writer is the point of the bucket, and
  G5 measured what a member writer does. This is a **named exception to ADR-0103 D1** ("the resolved affordance is
  the policy"): on every other bucket `userActions` overrides the default row, and on `synced` it cannot.
- **Every mechanism ADR-0103 guards a bucket with takes `synced`.** The 2026-07-20 addendum names three, and two
  mirrors judge the same set:
  - the engine write guard (`packages/plugins/plugin-security/src/system-write-guard.ts#ENGINE_OWNED_BUCKETS`,
    `#assertEngineOwnedWriteAllowed`), so a member's generic write is refused `403`. The pull writes as the system
    and passes by construction;
  - the `apiMethods` reconciliation (`packages/objectql/src/registry.ts#reconcileManagedApiMethods`), so the HTTP
    surface offers no write method the affordances deny;
  - the `/me/permissions` clamp (`GUARDED_WRITE_BUCKETS` in `packages/core/src/security/effective-object-permissions.ts`).
    It reads `userActions` directly. On `synced` that is always the closed row, since `userActions` cannot open one;
  - the two `PLATFORM_INTERNAL_MANAGED_BUCKETS` mirrors, in `packages/objectql/src/validation/rule-validator.ts`
    (`#staticReadonlyInsertSubject`'s list, pinned against the spec enum) and in
    `packages/lint/src/validate-readonly-flow-writes.ts`. Both hold the buckets that fail closed on a user-context
    write, which `synced` now is.
- **Readers that treat "`managedBy` set" as a platform object** keep their answer for `synced`, each for a stated
  reason:
  - `packages/core/src/security/user-assigned-work.ts` skips the object. A user field on a pulled row is source data
    that the next pull would overwrite, so it is not reassignable work;
  - both `claim-seed-ownership` passes (`packages/plugins/plugin-security/src/claim-seed-ownership.ts`,
    `packages/plugins/organizations/src/claim-org-seed-ownership.ts`) and the install-local seed owner
    (`packages/cloud-connection/src/marketplace-install-local-seed-owner.ts`) skip it. A `synced` row has no owner
    column to claim;
  - `ObjectQL.outlivesOrganization` (`packages/objectql/src/engine-cascade-planning.ts`) does **not** take `synced`,
    and nothing is exempted from either organization-delete refusal. Synced rows are business records the
    organization owns, and ruling [`6303358360`](https://github.com/objectstack-ai/objectstack/issues/24948#issuecomment-6303358360)
    (letter B, #24948) stands as it is: "Deleting an organization that still owns business records is refused, with
    per-table counts", and "The refusal runs **before anything is deleted**". The door's count and the engine's
    `refuseOrganizationDeleteWhileOwned` both count synced rows like any object's. Seat decision `6307135388` exempts
    `engine-owned` rows because nobody can delete them over the data API. For synced rows the answer is a way to
    remove them, not an exemption. So an organization holding synced rows is deleted in three steps, and the 409
    names the synced object among the tables:
    1. disable each pull job that writes into the organization, so no pull refills what is removed;
    2. delete the synced rows. An administrator's generic delete is refused by the guard, like a member's
       (`assertEngineOwnedWriteAllowed` lets only a system context through), so the P2 engine child adds a **purge**:
       it removes one mapping's rows in one organization as the system, through the engine's ordinary delete, and it
       is never a member's right. Who may run it is that child's to state. A declared action whose script body
       deletes them (it runs as the system, below) also works. Either way, the referencing-relations walk of that
       ordinary delete applies as it does today: a local lookup onto a synced row restricts, cascades or clears by
       its own `deleteBehavior`;
    3. delete the organization, which the two refusals now let through.

    A pull job whose organization is gone refuses its next run by name.
- **Declared actions may write the mapped fields, and nothing writes the `_sync_` columns except the pull.** An
  action's script body runs as the system (`packages/spec/src/ui/action.zod.ts#ActionSchema`, the `body` note), so a
  declared action may write a synced row's mapped fields. The next pull overwrites them, and the action is the
  reviewed place to make that choice. The declarative `operation: 'update'` row write runs as the caller and is refused
  like any member edit. A `_sync_` column in any write except the pull's is refused by name, whatever the caller's
  context (the engine child's writer). Write-back to the source is [D5](#d5--write-back-only-through-declared-actions)'s.
- **A sourced mapping targets a `synced` object, in `upsert` mode.** A `mapping` carrying `connectorSource` or
  `datasourceSource` whose `targetObject` is not `synced` is refused at build. Its `mode` must be `upsert`, with an
  `upsertKey`, because the other two modes each lose data:
  - `insert` cannot match a row again, so it duplicates every row on every run;
  - `update` never creates a row, so every row the source adds is dropped without a word.

  Measured before deciding: no `mapping` in `examples/` on `c9246279` carries a `connectorSource`, and no
  `objectstack-ai/hotcrm` mapping does at `235106f` (its `main` as fetched on 2026-11-10; the review read `6961ab1`
  with the same answer). So no known producer is narrowed, and per the startup-stage axis the rule lands at once,
  with no warning window.
- *Why a bucket and not `engine-owned` plus columns.* The bucket is the one key the guard, the affordance matrix, the
  injected-columns plan and the Console already branch on, and `engine-owned` names runtime rows the engine owns end
  to end, not business data an organization reads. The
  objection ADR-0103 D1 raised against a new value (an old Console falls through to editable) was retired by its
  2026-07-20 addendum: the server-side guard refuses the write whatever the client renders, and the Console's bucket
  union is closed (`ui/packages/types/src/managed-by.ts#ManagedByBucket`), so the P2 spec card carries its row.

**Record level: five platform columns under the reserved prefix `_sync_`**, injected by the plan in
`packages/spec/src/data/injected-system-columns.ts#resolveInjectedSystemColumns` on a `synced` object only:

| Column | Holds |
|:--|:--|
| `_sync_source` | the name of the `mapping` that wrote the row |
| `_sync_external_id` | the row's key in the source: the source values `upsertKey`'s target fields are copied from, as text |
| `_sync_pulled_at` | when a pull last wrote the row |
| `_sync_run_id` | the `sys_sync_run` row of that pull ([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)); text, not a lookup, so run retention never cascades into data |
| `_sync_deleted_at` | [D3](#d3--deletes-mark-or-ignore-never-a-physical-delete)'s mark |

- An index on (`organization_id`, `_sync_source`, `_sync_external_id`) serves the delete diff and the match.
- **The prefix is reserved.** An author field whose name starts `_sync_` is refused on any object. Field keys may
  start with `_` today, so this is a real narrowing. Measured: no field named `_sync_…` in `examples/` on `c9246279`
  or in hotcrm at `235106f`. The underscore keeps the platform's columns apart from an author's own `synced_at` or
  `external_id`, which the P0 probe itself declared.
- **FLS.** The columns are read-only at every door, a system-context action body included, and the pull is their
  only writer. They are readable wherever the
  row is, and field-level security may hide them like any field.
- **No person owner.** Pulled rows are attributed by `_sync_run_id`, never owned by the system: ADR-0073 D3 decouples
  attribution from ownership, so automation does not own the rows it writes. The plan injects no `owner_id` and no
  `owning_business_unit_id` on a `synced` object.
- **`sharingModel` is authored, with no bucket default.** A `synced` object is a custom object under ADR-0090 D1
  ("Custom objects default to OWD `private`; an unset `sharingModel` no longer means public"). The #8310 ruling made
  an authored OWD required at the object door: `security-owd-unset` is an error, "absence is not a decision", and it
  exempts only system objects (`packages/lint/src/validate-security-posture.ts#SECURITY_OWD_UNSET`). The author, and
  the Studio wizard, states the model. The rule's fix-it for a `synced` object recommends a model that does not hide
  owner-less rows, as #27472 made it do for an external object whose owner anchor is unprovable. A `private` `synced`
  object with no sharing rule that grants read is warned at author time, because an owner-scoped model over
  owner-less rows reads to no member (G4). Object permissions stay configured locally from zero, as the ruling says: a
  member reads synced rows only through a grant.

### D5 — Write-back only through declared actions

A change to source data is made in the source, through a declared action: an action of `type: 'flow'` whose flow
calls the connector with a `connector_action` node, or an action body that does. The action is gated, audited and
reviewed like any action; the connector's credential is its own (ADR-0143). The local row is not edited by the
write-back; **the next pull reconciles it**.

⛔ No bidirectional sync, no conflict merge, no Writeback-Dataset-style edits overlay (#27261 N3 stands, and the ruling
names all three). The guide's answer to 「改了能不能自动写回」 is this decision: no automatic write-back; a declared
action sends the change to the source, and the next pull brings it home.

### D6 — Drift: a mapped source column that is gone refuses the pull

A pull judges its `fieldMapping` sources against the source's shape **before it writes**, and a mapped column that
is missing refuses the whole pull (`source_column_missing`), never a run that skips the column.

- **Datasource source:** against the remote table's columns, read through the federation catalog
  (`packages/spec/src/data/external-catalog.zod.ts#ExternalCatalogSchema`, refreshed by
  `packages/spec/src/contracts/external-datasource-service.ts#IExternalDatasourceService`) or the driver's own
  introspection. Which of the two the reader asks first is open for the engine child.
- **`openapi` connector source:** against the read operation's declared response, which the connector builds from the
  document at registration (`packages/connectors/connector-openapi/src/openapi-connector.ts#buildOutputSchema`), at
  `recordsPath`.
- **`rest` connector source, or a source that declares no shape:** judged on **full pulls only**. A mapped source
  field absent from every record of a non-empty full pull refuses it, and absence on some records stays row data. An
  incremental pull often carries one or two records, and many APIs leave out a null field, so judging it would stall
  a healthy mapping on one sparse record. Its run record says `drift: unjudged`. A blank match key stays a row error
  whatever the pull (below). A record that lacks its watermark field is not judged today: the executor's
  `watermark_field_unmapped` judges the mapping (that some `fieldMapping` copies the watermark field), never a record.
  A source that drops the watermark column would then write on, G6's silent case, and a connector source would
  commit a position it cannot have read. So the engine child adds a **record-level refusal**: on an incremental
  connector pull, a record with no value at the watermark field refuses the pull (`source_watermark_missing`) before the position
  moves. A datasource source never reads such a row, since a NULL watermark is in no window (D2).
- A blank match key stays [#31810](https://github.com/objectstack-ai/objectstack/issues/31810)'s row error.

*Departure from the card's default:* the OpenAPI document is not hashed into a stored snapshot. The connector re-reads
the document at every registration, so the shape a pull is judged against is the one registered now; a stored hash
would be a second copy to go stale.

### D7 — The run record: `sys_sync_run`, beside `sys_job_run`

Every pull writes one row of a new platform object, `sys_sync_run`: the mapping, the source kind, the trigger
(`schedule` / `manual`), the `sys_job_run` id that drove it, the status (`running` / `completed` / `degraded` /
`failed`), start and end, the counts (read, created, updated, refused, marked deleted, `skipped_null_watermark`), the watermark it started from
and the watermark it committed, and the failure.

*Why its own object, read from what exists.* `sys_job_run` is deployment-level by ADR-0131 D7 (no tenant column),
readable only with `manage_platform_settings`, kept 30 days as telemetry, and generic to every job. A pull's run is
organization data: the organization's administrators read it, its rows reference it, and its committed watermark
([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)) must outlive a telemetry window.
So `sys_sync_run` is organization-owned (ADR-0131), engine-owned, and links the job run rather than extending it;
its retention is set by the engine card under ADR-0057-system-data-lifecycle-and-retention and is never shorter than
the job ledger's. **Retention never removes the latest committed run of a mapping**, because that row holds the
mapping's read position; how the sweep keeps it is open for the engine child.

- A pull logs one `info` line when it ends, with its counts (G7: none today).
- A run left `running` by a stopped server is closed `failed` with the reason `interrupted` at the next boot.
- **Studio shows** the run history on the synced object and on its source's page (the datasource or the connector):
  last run, status, counts, committed watermark, failure.

### D8 — Execution identity and organization

- **Identity.** A pull runs as the system (`{ isSystem: true, tenantId }`), as it does today: ADR-0073's
  `runAs: 'system'` posture, stated rather than defaulted, because the bucket's guard must not apply to its one
  writer. Attribution is concrete without ownership (ADR-0073 D3): `_sync_run_id` on the row, and
  `sys_sync_run.job_run_id` on the run.
- **Every synced row carries an organization** (ADR-0131 D1). The organization is the job's: declared
  (`JobSchema.organization`), or derived where the engine can derive one
  (`packages/runtime/src/app-artifact-handlers.ts#resolveJobPullOrganization`, the `single` posture).
- **Under the `isolated` and `group` postures, a `job` whose `pull` names a mapping must declare `organization`, or it
  is refused by name.** Ruling `6731568115` carries this as a standing rule: "A scheduled pull declares its
  organization in a multi-organization environment or the boot refuses, the same way ADR-0015's 2026-11-03 note
  treats an external object."
  - **What it narrows.** Ruling [`5974483403`](https://github.com/objectstack-ai/objectstack/issues/20281#issuecomment-5974483403)
    Q2-O1 made a job's organization "required under `isolated`, optional under `group`, absent under `single`" for
    every run form. The binder does exactly that today
    (`packages/runtime/src/app-artifact-handlers.ts#scheduleAppArtifactJobs`, through
    `packages/types/src/env.ts#resolveScheduledWorkPolicy`). Under `isolated` it does not schedule a job that declares
    none and logs `describeMissingJobOrganization`'s sentence at `error`. Under `group` it arms the job anyway, with
    the organization derived where the engine can derive one
    (`packages/runtime/src/app-artifact-handlers.ts#resolveJobPullOrganization`), else with none, and every
    tenant-scoped write then fails at ADR-0131 D9. This record makes the organization **required under `group` for
    the pull form only**. The body and handler forms keep Q2-O1, and `single` is unchanged.
  - **Where it is judged.** `packages/runtime/src/app-artifact-handlers.ts#scheduleAppArtifactJobs` arms package
    jobs for two callers: `AppPlugin` on `kernel:ready`, and the install-local plugin on its install route and its
    rehydrate (`packages/cloud-connection/src/marketplace-install-local-plugin.ts`). A runtime-stored job adds a
    third door. The refusal at each:
    - **at boot, from `AppPlugin`**: the boot is refused by name, as the standing rule says. This takes the place of
      today's `isolated` skip and `group` arming;
    - **at the install-local rehydrate**: the job is not armed, and is reported at `error` once. That door's precedent
      for an entry an older build installed is "reported and not run", and a pull job keeps that precedent. The
      install route below refuses the shape from now on, so only an entry installed before this rule can reach the
      rehydrate. Refusing the boot for it would lock a deployment out over an entry nobody can edit without booting;
    - **at the install route**: the install is refused by name (`422`) before anything it carries lands, so a running
      deployment never holds a package whose next boot it would refuse;
    - **at the runtime door** ([D11](#d11--the-studio-door-a-runtime-pull-job)): the write is refused, with the same
      sentence.
  - **When scheduled work is switched off.** `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` is off by default in every
    posture. With it off, the binder arms no package job and says so once at `info`. A job that is never armed writes
    nothing, so the boot judges no pull job and is not refused; the next boot with the switch on judges every one.
    The install route and the runtime door judge regardless of the switch, because the author is there to fix the
    job when it is written.
  - **The describe changes with the binder.** `JOB_ORGANIZATION_DESCRIPTION` (`packages/spec/src/system/job.zod.ts`)
    states today's split, and it becomes false the day the binder changes. It is rewritten in the PR that changes the
    binder, by that PR's child ([P2 — engine](#children-the-epic-files-on-acceptance)).
  - Work wanted in several organizations is one job per organization; a pull is never fanned out.
- **Whose rows a pull reads.** The pull reads as the system, and the wall's predicate is composed for a user context
  only. A system read of a federated object carries no organization predicate of its own. So the pull writes its own:
  - **a connector source** carries no organization: the connector's credential is organization-shared (ADR-0143),
    and the pull reads the source as configured;
  - **a datasource source under a walled posture** states its organization scope as ADR-0015's 2026-11-03 note
    requires, in one of its ways:
    - **its own `organization_id`** (the remote rows carry the column): the pull's `where` adds
      `organization_id = <the job's organization>` to every window and page, and the floor applies it again in
      memory. A job in one organization never copies another organization's rows;
    - **shared** (`tenancy: { enabled: false }` or `systemFields: { tenant: false }`): every organization may read
      every row, so the pull reads them all, which is what shared means;
    - a source whose scope cannot be written as one of those (an unstated scope, which the Layer 0 verdict denies
      after boot) refuses the pull by name (`source_organization_scope_unstated`);
  - **under `single`** there is no wall, and the source is read as configured.

### D9 — Open-source placement (ruled)

Recorded, not re-opened: the sync kernel — the `mapping` / `job` / pull executor, a datasource as a pull source,
paging, the delete policy, the provenance columns and the `synced` bucket — ships in this repository under
Apache-2.0, as federation does (`6731568115`; the edition table of `6738924490`). The same ruling reads: "Vendor-specific
drivers and connectors stay out of this repository (#27261 P2 ruling)". The Snowflake and BigQuery drivers are
therefore plugin packages outside it, and who builds them is decided when the P3 warehouse-drivers child is filed
([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)). Record-level lineage is Enterprise and is not this
record's; the `_sync_` columns are the kernel's operational metadata, not lineage.

### D10 — The three-way rule, and the partner stance

What the guide and the skills teach, extending the "Which way in" rule of `content/docs/data-modeling/virtual-objects.mdx`:

| The need | Choose |
|:--|:--|
| Live data, one table at a time; the legacy system must not be touched; data that must not land | **federation** — a virtual object (ADR-0015) |
| Reports, analysis, AI question answering, joins across sources; a slow or fragile legacy system; a warehouse's results | **sync-in** — a `synced` object, a sourced `mapping` and a `job` (this record) |
| Trigger something in an external system; no rows land | **a connector action** — a flow `connector_action` node, or a declared action |

**The partner stance.** ObjectStack does not build pipelines or transforms. Joining, cleaning and aggregating across
sources is the warehouse's or the ETL vendor's job; ObjectStack syncs the result in. A `mapping`'s per-field
`transform` stays what it is (a per-row conversion), and ⛔ never grows into a pipeline.

### D11 — The Studio door: a runtime pull job

*Added beside the card's D1–D10, because G8 cannot close without it.* `job` is code-only today
(`packages/spec/src/kernel/metadata-plugin.zod.ts#DEFAULT_METADATA_TYPE_REGISTRY`), and the registry's note names the
condition for re-opening it in full:

> Re-opening this type means designing a handler a runtime writer can actually name — e.g. constraining `handler` to
> an already-registered flow or a named, separately-governed function — and then building the bridge from job
> metadata to `IJobService.schedule`. Opening the flag without that work just restores the silent no-op.

This record meets both halves for the pull form, and only for it:

- **A handler a runtime writer can name.** A `pull` job names no handler. It names a `mapping`, which a runtime writer
  can already create. So the runtime door accepts a `job` whose only run form is `pull`, and refuses a `body` or a
  `handler` there.
- **The bridge.** Today jobs are armed only from a package: `packages/runtime/src/app-artifact-handlers.ts#scheduleAppArtifactJobs`,
  called by `AppPlugin` and by the install-local plugin (D8), and nothing schedules a job stored at runtime. The bridge arms a stored pull job on `IJobService.schedule` when it is written, re-arms it
  when it changes, cancels it when it is deleted, and re-arms every stored pull job at boot.
- **The two rules at that door.** The scheduled-work switch gates a runtime pull job as it gates a package one. With
  the switch off, the job is stored and not armed, and the write answer says so: the author is not left with a job
  that silently never runs. D8's organization rule is judged at the write.
- ⛔ The flag opens **in the same PR as the bridge**, never before it. Opened alone, it restores the silent no-op the
  note warns of. That PR is its own child ([P2 — runtime job door](#children-the-epic-files-on-acceptance)).

The Studio sync wizard creates the `synced` object, the `mapping` and that `job`. Every other job stays code-only.

---

## Children the epic files on acceptance

Filed by the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763) after this record is accepted;
⛔ none is filed by this record.

Every row carries its own `Clause-②` arm (`scripts/pm/clause2-line.mjs`) and one `Metadata-protocol` line per PR;
where a PR changes more than one kind, the line names the strongest (`narrowed` over `semantic` over `added`, AGENTS.md).

| Child | Lane · size | Scope | Declaration | Order |
|:--|:--|:--|:--|:--|
| **P2 — spec** | `domain:spec` · M | The keys `datasourceSource`, `paging` (`none` included), `deletePolicy` (no schema default: absence reads as `mark`) and `deletedField`, each as a `planned` liveness row under `authorWarn`. The refusals, which are live as they land: exclusive source, a federated source object, a halvable `watermark.field`, sourced target, `upsert` mode and the `_sync_` reservation. `job.pull` accepting either source. `managedBy: 'synced'` **with every mechanism that enforces it**: the guard set, the reconciliation, the clamp, both mirrors and the `ui/` bucket union, since a security bucket never lands unenforced (ADR-0049). The `userActions` exception (D4). `security-owd-unset`'s `synced` fix-it (D4). `CONNECTOR_SOURCE_NO_POLICY`'s `deleteMode` guidance re-pointed at `deletePolicy`. | `Clause-②: yes (narrowing)`: the keys widen and the refusals narrow, so it is breaking, with the migration and ADR-0087 disposition that brings. `Metadata-protocol: narrowed`. | first |
| **P2 — engine** | `domain:server` · L | Keyset paging with no cap on a built-in driver (D1, D2). The windowed read `lo <= field < hi` through the floor on a floored driver: canon-aligned bounds, the halving, the in-memory match count on `ExternalRowCapExceededError`, and `sync_window_unsplittable` and `sync_bounds_not_pushed` (D1, D2). The organization predicate and `source_organization_scope_unstated` (D8). The connector paging loop and the committed position, the largest value read (D2). Delete marking with the completeness rule, its range limit and the NULL-watermark count, and the incremental-`mark` refusal (D3). Provenance stamping, the injected-columns plan rows (`resolveInjectedSystemColumns`, in `packages/spec`), the `_sync_` write refusal and the purge (D4). The three drift arms and the record-level watermark refusal (D6). `sys_sync_run`, its writer, its retention rule, the end-of-pull log line and the interrupted-run close (D7). D8 at boot and at the install route, with `JOB_ORGANIZATION_DESCRIPTION` rewritten. `ExternalRowCapExceededError`'s remedy re-pointed from the retired `DataSync` to sync-in. The windowed-read conformance cases, a source row finer than a millisecond among them. Each `planned` row flips to `live` with the reader that makes it true, and its `authorWarn` is dropped. | `Clause-②: no (narrowing)`: D8 makes `job.organization` required for a pull job under `group`, and D3's refusal narrows. A connector pull's starting point also moves to the committed position, which is a change of meaning. `Metadata-protocol: narrowed` (narrowed over semantic). | after P2 spec |
| **P2 — runtime job door** | `domain:server` · M | D11: the pull-only acceptance, the flag flip in `DEFAULT_METADATA_TYPE_REGISTRY`, the bridge to `IJobService.schedule` (arm, re-arm, cancel, boot re-arm), the scheduled-work switch at the write and D8's refusal at the write. | `Clause-②: yes (widening)`: `job` becomes writable at runtime, for the pull form only. `Metadata-protocol: added`. | after P2 engine |
| **P3 — Studio** | ui · M | The sync wizard beside the virtual-object one (`offersSync`'s page): the source object (drafting it when the table has none), field map, sharing model, cadence, organization. Read-only rendering of `synced` objects. Run history (D7). | `Clause-②: no`. `Metadata-protocol: none`. | after P2 runtime job door |
| **P3 — guide + skills** | devx / skills · S | The three-way rule and the partner stance (D10), the write-back answer (D5), and `SYNC_ARCHITECTURE.md` and the skills pointing at `mapping` / `job`, never at the retired vocabulary. | `Clause-②: no`. `Metadata-protocol: none`. | after P2 engine |
| **P3 — warehouse drivers** | outside this repository · M each | Snowflake and BigQuery plugin driver packages, out of this repository per ruling `6731568115`, verified by the conformance kit with the windowed-read cases (D1). Who builds them is the maintainer's call when this row is filed. | Declared by each package. | after P2 engine |

**Workload, re-estimated.** The epic's estimate (P2 ≈ 5–8 agent-days, P3 ≈ 3–4) predates four additions: the windowed
read with its halving, `sys_sync_run` with a committed read position, D11's bridge, and three drift arms. Re-estimated:
P2 spec ≈ 2–3 agent-days, P2 engine ≈ 6–9, P2 runtime job door ≈ 2–3, P3 Studio ≈ 3, P3 guide + skills ≈ 1, and each
warehouse driver ≈ 2–3. P2 in total is about 10–15 agent-days.

**Order: spec first, as the epic's table and the #20281 precedent have it.** The pull's ENFORCE route was ruled
three staged PRs, spec then service then job
([`5904845660`](https://github.com/objectstack-ai/objectstack/issues/20281#issuecomment-5904845660)), and keys that
land before their reader land as `planned` rows under `authorWarn`, which the reader's PR flips (the #30259 →
#30260 pattern recorded in `packages/spec/liveness/action.json`). The tree also requires it:
- no door can store a mapping with `datasourceSource`, or an object with `managedBy: 'synced'`, until the spec child
  lands, because both schemas are strict;
- the bucket mirrors are pinned against the spec enum.

What each PR can prove is the order's test. P2 spec proves its refusals and the bucket's enforcement; its keys
warn their author until P2 engine proves the readers. P2 engine proves every reader against stored shapes the spec
already parses. The runtime job door proves the bridge against a stored pull job.

---

## Consequences

- A synced object is an ordinary object to every reader: datasets, reports, the MCP `query` tool and flows need no
  change, which is the epic's done-when. The readers that branch on `managedBy` are the exception. D4 names each
  one and its answer for `synced`.
- Members cannot edit pulled rows, so the silent keep-or-overwrite of G5 is gone; the change to source data goes
  through a reviewed action.
- A pull reads every page and resumes from a committed point; a source delete and a dropped column are visible
  (a mark, a refused run), never silent.
- **Narrowing for authors:**
  - a sourced mapping must target a `synced` object in `upsert` mode, and `_sync_` is a reserved field prefix. No
    known producer is affected: D4 measures both;
  - a pull job under `group` must declare its organization, which narrows ruling `5974483403` Q2-O1 for the pull
    form (D8);
  - a `synced` object's `userActions` cannot open a write (D4);
  - an incremental source with `deletePolicy` absent or `'mark'` must state `deletedField`, or write
    `deletePolicy: 'ignore'`. Because absence reads as `mark`, this refuses every incremental sourced mapping that
    states only a watermark (D3);
  - a datasource source reads a declared federated object, on a halvable watermark field (D1, D2).

  The children declare each one.
- **A plugin driver's row cap no longer bounds a pull, and the floor stays whole.** A built-in driver is paged by
  keyset with no cap, as ruling `6487532394` leaves it. A floored plugin driver is read through the floor in windows
  bounded on both sides, halving a window that comes back over the cap. That costs round trips on a large table and
  lifts nothing in the ruling. **It needs both bounds pushed down.** A driver that pushes only one bound, or none,
  cannot be pulled past the cap (`sync_bounds_not_pushed`), as it cannot be read past it through federation (D1, D2).
- **Ruling `6303358360` stands unnarrowed.** An organization that holds synced rows is deleted after its pull jobs are
  disabled and its synced rows purged (D4).
- Synced tables become the largest tables. Retention and archive under ADR-0057-system-data-lifecycle-and-retention
  apply to them as to any object; a `synced` object may declare its own lifecycle.
- The retired `DataSync` / `ETLPipeline` words stay retired: every surface this record names teaches `mapping` and
  `job`.

## Alternatives considered

- **One `source` union on `mapping`** (the card's alternative): a rename of a live key for no new capability. Not
  taken (D1).
- **A new metadata type for a sync**: two definitions of one target; ruled out by the card and by "a sync is defined on
  its TARGET". Not taken.
- **Reuse `engine-owned` for synced objects**: no provenance plan, and a bucket that means "no business rows". Not taken
  (D4).
- **Read in open-ended keyset batches through the floor**: the floor sends cap + 1 whatever the batch limit, so a
  batch whose predicate matches more than the cap is refused however small its `limit`. Not taken (D1).
- **One reader beneath the floor, checking each batch** (this record's previous draft): it skips the floor that ruling
  `6487532394` Q1 = B gives every plugin driver, and its checks cannot see a driver that, correctly for the floor,
  sorts a remote page itself. Each batch would then not be the first rows in order, and the committed position would
  pass rows never read. Not taken (D1).
- **Windows cut `lo < field <= hi`, committing each window's `hi`** (this record's second draft): under the floor's
  millisecond truncation the shape drops a row finer than a millisecond at every lower edge, and a committed `hi`
  above the source's maximum passes rows written later. Not taken (D2).
- **Delete an organization's synced rows inside the organization delete** (this record's second draft): it runs
  before the refusal, which ruling `6303358360` forbids, and it narrows that ruling for one bucket. Not taken (D4).
- **Cap a built-in driver's read like a floored one** (this record's second draft): the schema refuses
  `external.rowCap` on a built-in driver, so one value holding 1,000 rows would refuse a Postgres pull with no
  remedy. Not taken (D2).
- **Pull the verified-pushdown credential (#27261 P3) into this epic**: it would lift the floor for every read of a
  certified driver, a wider change than a pull needs. Not taken (D1).
- **A `public_read` default on the bucket**: a fail-open default for business data, against ADR-0090 D1 and the
  #8310 ruling. Not taken (D4).
- **Record pulls on `sys_job_run`**: deployment-level, platform-only, 30-day telemetry; the wrong owner and the wrong
  lifetime for an organization's run history. Not taken (D7).
- **A physical delete, or a recycle-bin delete now**: drops locally referenced rows on the source's word, before the
  bin exists. Not taken (D3).
- **Keep pulls into ordinary objects legal, warn only**: leaves G5 open for every author who skips the warning; the
  contract tightens instead, with no producer to stage for (D4).

## What this record does not decide

- ⛔ Bidirectional sync, conflict merge, an edits overlay, pipelines and transforms (ruled non-goals).
- ⛔ Record-level lineage and label-based access control (Enterprise; cloud#4163, cloud#4164).
- ⛔ A `delete` value for `deletePolicy`, until ADR-0148's recycle bin ships.
- ⛔ Local-only editable fields on a `synced` object (annotations live on a local object that looks the synced row
  up).
- ⛔ Change-data-capture or push from a source; a pull is scheduled.
- ⛔ Any vendor driver or connector; who builds the warehouse driver packages outside this repository (the P3
  warehouse-drivers child, D1).

**Open points left to the engine child**, each to be decided in its PR and said there:

- the first window width, how it grows, and how often the open-above window is tried (D2);
- who may run the purge of a mapping's rows in one organization (D4);
- a compound window (the watermark, then a second field) for a value that holds more rows than the cap (D2);
- rows that reach the source with a watermark below a position already committed (late writes): whether a window
  trails the present by a declared settle time (D2);
- `sys_sync_run` retention against the read position it holds: the latest committed run of a mapping must survive
  the sweep (D7);
- a composite `upsertKey` written as `_sync_external_id` text: the encoding, and an order that stays stable (D4);
- two mappings on one target object: whether they are refused, or each marks only its own rows by `_sync_source`
  (D3, D4);
- the catalog or the driver's own introspection, and which the drift judgment asks first (D6).

## References

- [#31763](https://github.com/objectstack-ai/objectstack/issues/31763) — the epic; ruling `6731568115`, amendments
  `6731744658` and `6738924490`.
- [#31778](https://github.com/objectstack-ai/objectstack/issues/31778) — the P0 measurement, report `6732731853`.
- [#27261](https://github.com/objectstack-ai/objectstack/issues/27261) — ontology over external systems (closed);
  rulings `6471382887`, `6486136301`, `6486145005`, close-out `6523503305`.
- [ADR-0015](./0015-external-datasource-federation.md), [ADR-0062](./0062-external-datasource-runtime.md),
  [ADR-0049](./0049-no-unenforced-security-properties.md), [ADR-0078](./0078-no-silently-inert-metadata.md),
  [ADR-0103](./0103-managedby-write-policy-and-engine-write-guard.md),
  [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md),
  [ADR-0073](./0073-automation-execution-identity.md),
  [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md),
  [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md),
  [ADR-0090](./0090-permission-model-v2-concept-convergence.md).
- [#20281](https://github.com/objectstack-ai/objectstack/issues/20281) — the pull's ENFORCE route; rulings
  `5904845660` (stages) and `5974483403` (Q2-O1, a job's organization).
- [#27277](https://github.com/objectstack-ai/objectstack/issues/27277) — the external-driver floor, ruling
  `6487532394`.
- `packages/spec/src/migrations/entries/semantic/17.etl-pipeline-layer-retired.ts`,
  `packages/spec/src/migrations/entries/semantic/18.connector-sync-keys-retired.ts` — why the old layers left, and the
  way back.
