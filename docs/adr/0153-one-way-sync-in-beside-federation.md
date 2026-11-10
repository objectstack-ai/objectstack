# ADR-0153: One-way sync-in beside federation — a connector, a federated datasource or a warehouse fills an ordinary object marked `synced`, read-only to members, written back only through declared actions

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
- **Consumers**: `@objectstack/spec` (`mapping`, `job`, `managedBy`, the injected-columns plan), `@objectstack/objectql` (the sync reader beneath the external-driver floor, the reconciliation, the readonly-strip mirror), `@objectstack/service-automation` (the pull executor), `@objectstack/core` (the import runner, the `/me/permissions` clamp), `@objectstack/runtime` (the job binder, its organization refusal and the runtime job bridge), `@objectstack/plugin-security` (the bucket's write guard), `@objectstack/platform-objects` (the run record), `@objectstack/lint`, `ui/` (the bucket union, the Studio wizard, read-only rendering), `content/docs` and `skills/`.

---

## Provenance

1. **Decision card** (triage, 2026-11-09T03:02Z, kept in the epic body): the maintainer's 「我就是想做 palentir 开源替代方案，立决策卡」, options A / B / C, with A recommended.
2. **Ruling A** `6731568115` and its amendments `6731744658` and `6738924490`, quoted above.
3. **P0 measurement** [#31778](https://github.com/objectstack-ai/objectstack/issues/31778), os-dev report [`6732731853`](https://github.com/objectstack-ai/objectstack/issues/31778#issuecomment-6732731853): the existing pull path (a `rest` connector, `mapping.connectorSource`, `job.pull`) run end to end on a production-mode `os serve` at `c2bb879f`, one reading per gap G1–G9. [Current state](#current-state-g1g9) is written from it and re-read on `origin/main` `c9246279`.
4. **This card**, claimed for `domain:spec#2` in [`6754703995`](https://github.com/objectstack-ai/objectstack/issues/31780#issuecomment-6754703995).

---

## TL;DR

1. **Sync-in is a second way in, beside federation, not a replacement for it.** A remote table or API collection becomes an ordinary object whose rows were **copied** by a pull. Every platform surface (permissions, RLS, reports, datasets, flows, MCP, AI) reads it as it reads any object. Federation stays the answer when a copy would be wrong ([D10](#d10--the-three-way-rule-and-the-partner-stance)).
2. **Three sources, one binding home.** `mapping.connectorSource` (a `rest` / `openapi` connector) stays; a sibling `mapping.datasourceSource { datasource, remoteName, remoteSchema?, watermark? }` makes any federated datasource a pull source, a warehouse included; exactly one source per mapping. A plugin driver's row cap does not bound a pull: the sync reader reads beneath the engine's floor in verified keyset batches. Snowflake and BigQuery drivers move from the engine child to a child of their own (a departure from the epic's row) ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)).
3. **A pull reads every page.** A declared `paging { style, param, nextPath }` on the connector source; keyset batches on the datasource source; the starting point of the next pull is the watermark a pull has **committed** ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)).
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
  datasource: 'warehouse',        // a datasource whose schemaMode is 'external' or 'validate-only'
  remoteName: 'fact_orders',      // the remote table or view
  remoteSchema: 'mart',           // optional — the remote schema, as object.external.remoteSchema spells it
  watermark: { field: 'updated_at' },  // optional — timestamp-incremental; no `param`, the reader writes the predicate
}
```

- **Exactly one source per mapping.** A mapping carrying both `connectorSource` and `datasourceSource` is refused at
  parse; a mapping carrying neither stays the import door's mapping, unchanged.
- **The reader is the datasource's own driver**, through the connection service (ADR-0062 D1), selecting the source
  columns `fieldMapping` names. The pull only reads, so the datasource's write gate (ADR-0015 gate 3) is never asked.
- **How the reader addresses the remote table.** A built-in SQL driver finds a remote table only through an external
  binding (`remoteName`, `remoteSchema`, the column map) that `registerExternalObject` installs
  (`packages/spec/src/contracts/data-driver.ts#IDataDriver`). The reader installs that binding itself, under a
  reader-private name derived from the mapping, and ⛔ never registers an object: no federated object is declared, so
  the remote table gets no REST route, no Console surface and no permission row. A driver without
  `registerExternalObject` (a plugin driver) is handed `remoteName` as the object it reads, which is how its `find`
  addresses a table.
- **A managed datasource is refused as a source.** Its objects are already local; a pull from it would make a second
  copy of rows the platform already owns.
- **The sync reader reads beneath the external-driver floor.** A plugin driver on a non-managed datasource runs under
  the engine's correctness floor (`packages/objectql/src/external-driver-floor.ts#createExternalDriverFloor`, ruling
  `6487532394` on #27277). The floor sends the driver `where`, `orderBy` and `limit` cap + 1, never `offset`, and it
  throws `ExternalRowCapExceededError` when more than the cap comes back. The cap defaults to 1,000 and is never above
  `packages/spec/src/data/datasource.zod.ts#EXTERNAL_ROW_CAP_CEILING` (10,000). It sends cap + 1 whatever limit the
  caller asked for, so through the floor any batch whose predicate matches more than the cap is refused. Keyset
  batches cannot get past that, and neither can a smaller `limit`. A table above the cap could then never be pulled.
  So the P2 engine child builds **one caller beneath the floor**: the sync reader. It is system-only and read-only,
  and it reads the driver behind the floor (`packages/objectql/src/external-driver-floor.ts#unwrapExternalDriverFloor`)
  on these terms:
  - each batch is a **keyset read**: `where` = after the last read position (D2), `orderBy` = the watermark field then
    the source key, `limit` = B. It ⛔ never sends `offset`. B is the datasource's resolved row cap
    (`packages/objectql/src/external-driver-errors.ts#resolveExternalRowCap`), so a batch holds no more rows in memory
    than a federated read may;
  - **every answer is verified before anything is written.** The batch has at most B rows. Every row satisfies the
    `where` that was sent, re-evaluated in memory with the floor's own evaluator
    (`packages/objectql/src/driver-query-in-memory.ts#applyDriverQueryInMemory`). The rows ascend strictly by
    (watermark, key). A batch that fails any check refuses the pull by name (`sync_read_unverified`, naming the check),
    and nothing past the last verified batch is committed;
  - **what this cannot see.** A driver that silently leaves out rows that match is not detectable from its answer.
    That is the trust a `rest` source already gets, and the pull-path conformance cases the engine child adds to
    `packages/objectql/src/plugin-driver-conformance.ts#definePluginDriverConformanceSuite` test for it;
  - every other read keeps the floor. The verified-pushdown credential (#27261's P3) is neither needed nor built here.

  A built-in driver is not floored. It is read by the same reader under the same checks, which cost it nothing.
- **Warehouses: a departure from the epic's P2 engine row.** That row reads "datasource-as-source reader incl.
  Snowflake / BigQuery dialects", and amendment `6731744658` makes a warehouse a first-class pull source. This record
  keeps the first-class source and moves the two drivers out of the engine child:
  - the repository spells a warehouse driver as a plugin. `com.vendor.snowflake` is the driver vocabulary's own
    example of a plugin-contributed driver, and `DRIVER_VOCABULARY` names no warehouse id
    (`packages/spec/src/data/driver/config-registry.zod.ts#BUILTIN_DRIVER_IDS`);
  - the reader beneath the floor is what makes a plugin warehouse pullable at any size. The engine child owes that
    reader and its conformance cases; it owes no vendor dialect;
  - Snowflake and BigQuery go to a child of their own, **P3 — warehouse drivers**: one plugin package per warehouse,
    verified by the conformance kit including the pull-path cases. Whether those packages live in this repository or
    with a partner is the maintainer's call when the epic files that child. The #27261 close-out
    [`6523503305`](https://github.com/objectstack-ai/objectstack/issues/27261#issuecomment-6523503305) keeps "vendor
    drivers such as Salesforce and SAP v2" out of this repository, and it does not name a warehouse.

  The SQL driver's federated dialects (ADR-0015 §4.6: Postgres, MySQL, SQLite, and the federation-only Oracle and
  SQL Server) serve as pull sources as soon as the engine child lands.
- **`job.pull` widens to either source.** `defineStack` today refuses a pull whose mapping declares no
  `connectorSource` (`packages/spec/src/stack.zod.ts#collectJobPullMappingErrors`); it accepts either source.

*Why a sibling, not one `source` union (the card's alternative).* `connectorSource` is a published, live key. Folding
it into a union renames it for every author for no new capability; a sibling adds one optional key and leaves every
existing binding as it is. ⛔ Not a new metadata type: the sync stays defined on its target, the `mapping`.

*Departure from the card's default:* `remoteSchema` is added beside the three working names. A warehouse table is
addressed by schema and name (`mart.fact_orders`, ADR-0015 §8), and federation spells the pair the same way
(`packages/spec/src/data/object.zod.ts#ObjectExternalBindingSchema`).

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

**Datasource source.** The reader reads keyset batches ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)):
ascending by the watermark field, then by the source key, each batch starting strictly after the last (watermark,
key) pair read, `limit` B, never `offset`. The pair, not the watermark alone, is the read position, so rows that tie
on the watermark across a batch boundary are neither skipped nor read twice. A full pull (no `watermark`) keys on the
source key alone. Writes go through the import runner in its own batches
(`packages/core/src/utils/import-runner.ts#MAX_CREATE_BATCH_SIZE`). It needs no declaration.

**The starting point is a committed watermark.** Today's starting point is the highest value already written to the
target (the executor's W1 read). It becomes the highest watermark a pull has **committed**, stored on the run record
([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)):

- a **datasource source** reads in ascending (watermark, key) order, so it commits that pair after each written
  batch, and an interrupted pull resumes after its last committed batch;
- a **connector source** cannot see the source's order, so it commits once, after its last page. An interrupted
  connector pull re-reads from the previous commit, and the upsert makes the re-read idempotent. This closes the
  newest-first loss the `watermark` describe warns about.

*Departure from the card's default:* "the watermark is committed per batch" holds for the datasource source only.
Committing per page on a source whose order the platform cannot see would advance past pages it never read.

### D3 — Deletes: mark or ignore, never a physical delete

Each source block gains `deletePolicy: 'mark' | 'ignore'`, default `mark`.

- **`mark`** stamps the platform column `_sync_deleted_at` ([D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns))
  on a row the source no longer has, and clears it if the row comes back. Two detections:
  - a **full** pull (no `watermark`) marks every row of this mapping that a completed pull did not read, **only when
    the pull read a set it can prove complete**. A datasource source's keyset read is complete when its last batch
    comes back short. A connector source is complete only when it declares `paging` ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)),
    `none` included, and the pull read to its last page. A full connector pull with no `paging` marks nothing, and its
    run record says so (`deletes: unjudged, no paging declared`): P0 measured a paged endpoint read as one response
    (100 of 250 rows, every run `success`), and marking from that read would mark every row past page one. An
    interrupted or refused pull marks nothing;
  - an **incremental** pull cannot see an absence, so it reads a source soft-delete field: `deletedField`, a source
    field whose truthy value means the row was deleted at the source.
- **An incremental source that cannot see deletes refuses at build.** `watermark` with `deletePolicy: 'mark'` and no
  `deletedField` is a declared policy no runtime line could honour (ADR-0078): the author states `deletedField` or
  `deletePolicy: 'ignore'`.
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
  - `ObjectQL.outlivesOrganization` (`packages/objectql/src/engine-cascade-planning.ts`) does **not** take `synced`.
    Synced rows are the organization's business data and go with an organization delete as any object's rows do. The
    engine child pins that the cascade's system delete passes the guard.
- **Declared actions may write the mapped fields, and nothing writes the `_sync_` columns except the pull.** An
  action's script body runs as the system (`packages/spec/src/ui/action.zod.ts#ActionSchema`, the `body` note), so a
  declared action may write a synced row's mapped fields. The next pull overwrites them, and the action is the
  reviewed place to make that choice. The declarative `type: 'update'` row write runs as the caller and is refused
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
  a healthy mapping on one sparse record. Its run record says `drift: unjudged`. The fields a pull needs on every
  record keep their own refusals whatever the pull: the watermark field, and the `upsertKey` sources through the blank
  match key's row error.
- A blank match key stays [#31810](https://github.com/objectstack-ai/objectstack/issues/31810)'s row error.

*Departure from the card's default:* the OpenAPI document is not hashed into a stored snapshot. The connector re-reads
the document at every registration, so the shape a pull is judged against is the one registered now; a stored hash
would be a second copy to go stale.

### D7 — The run record: `sys_sync_run`, beside `sys_job_run`

Every pull writes one row of a new platform object, `sys_sync_run`: the mapping, the source kind, the trigger
(`schedule` / `manual`), the `sys_job_run` id that drove it, the status (`running` / `completed` / `degraded` /
`failed`), start and end, the counts (read, created, updated, refused, marked deleted), the watermark it started from
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
  - **Where it is judged.** At boot, where the binder arms package jobs, the refusal takes the place of today's
    `isolated` skip and `group` arming. At the runtime door ([D11](#d11--the-studio-door-a-runtime-pull-job)) there
    is no boot, so a pull job written without one is refused at the write, with the same sentence.
  - **When scheduled work is switched off.** `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` is off by default in every
    posture. With it off, the binder arms no package job and says so once at `info`. A job that is never armed writes
    nothing, so no pull job is judged and no boot is refused. The next boot with the switch on judges every pull job.
  - **The describe changes with the binder.** `JOB_ORGANIZATION_DESCRIPTION` (`packages/spec/src/system/job.zod.ts`)
    states today's split, and it becomes false the day the binder changes. It is rewritten in the PR that changes the
    binder, by that PR's child ([P2 — engine](#children-the-epic-files-on-acceptance)).
  - Work wanted in several organizations is one job per organization; a pull is never fanned out.
- A source carries no organization of its own: the datasource is environment-scoped (ADR-0015 §10), and the
  connector's credential is organization-shared (ADR-0143). The pull reads the source as configured and writes into
  the job's organization.

### D9 — Open-source placement (ruled)

Recorded, not re-opened: the sync kernel — the `mapping` / `job` / pull executor, a datasource as a pull source,
paging, the delete policy, the provenance columns and the `synced` bucket — ships in this repository under
Apache-2.0, as federation does (`6731568115`; the edition table of `6738924490`). Vendor drivers such as Salesforce
and SAP v2 stay outside this repository (#27261 close-out); where the warehouse driver packages live is decided when
the P3 warehouse-drivers child is filed ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)). Record-level lineage is Enterprise and is not this
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
- **The bridge.** Today only `AppPlugin` schedules jobs, from the artifact
  (`packages/runtime/src/app-artifact-handlers.ts#scheduleAppArtifactJobs` has one caller), and nothing schedules a
  job stored at runtime. The bridge arms a stored pull job on `IJobService.schedule` when it is written, re-arms it
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

Every row carries its own `Clause-②` and `Metadata-protocol` lines. A row that changes more than one kind names each
kind, and each PR that carries one declares it.

| Child | Lane · size | Scope | Declaration | Order |
|:--|:--|:--|:--|:--|
| **P2 — spec** | `domain:spec` · M | The keys `datasourceSource`, `paging` (`none` included), `deletePolicy` and `deletedField`, each as a `planned` liveness row under `authorWarn`. The refusals, which are live as they land: exclusive source, sourced target, `upsert` mode, the `_sync_` reservation, and an incremental `mark` with no `deletedField`. `job.pull` accepting either source. `managedBy: 'synced'` **with every mechanism that enforces it**: the guard set, the reconciliation, the clamp, both mirrors and the `ui/` bucket union, since a security bucket never lands unenforced (ADR-0049). The `userActions` exception (D4). `security-owd-unset`'s `synced` fix-it (D4). `CONNECTOR_SOURCE_NO_POLICY`'s `deleteMode` guidance re-pointed at `deletePolicy`. | `Clause-②: yes (widening)` for the keys. `Metadata-protocol: added` for the keys, `narrowed` for the refusals. | first |
| **P2 — engine** | `domain:server` · L | The sync reader beneath the floor, its addressing and its verification (D1). The paging loop, the keyset read and the committed read position (D2). Delete marking with the completeness rule (D3). Provenance stamping, the injected-columns plan rows (`resolveInjectedSystemColumns`, in `packages/spec`), the `_sync_` write refusal and the cascade pin (D4). The three drift arms (D6). `sys_sync_run`, its writer, its retention rule, the end-of-pull log line and the interrupted-run close (D7). D8's refusal at boot, with `JOB_ORGANIZATION_DESCRIPTION` rewritten. The pull-path conformance cases. Each `planned` row flips to `live` with the reader that makes it true, and its `authorWarn` is dropped. | `Clause-②: no`. `Metadata-protocol: semantic`: a connector pull's starting point moves from the target's highest value to the committed position, and the `watermark` describe changes with it. `narrowed`: D8 makes `job.organization` required for a pull job under `group`. | after P2 spec |
| **P2 — runtime job door** | `domain:server` · M | D11: the pull-only acceptance, the flag flip in `DEFAULT_METADATA_TYPE_REGISTRY`, the bridge to `IJobService.schedule` (arm, re-arm, cancel, boot re-arm), the scheduled-work switch at the write and D8's refusal at the write. | `Clause-②: yes (widening)`: `job` becomes writable at runtime, for the pull form only. `Metadata-protocol: added`. | after P2 engine |
| **P3 — Studio** | ui · M | The sync wizard beside the virtual-object one (`offersSync`'s page): source, remote table or operation, field map, sharing model, cadence, organization. Read-only rendering of `synced` objects. Run history (D7). | `Clause-②: no`. `Metadata-protocol: none`. | after P2 runtime job door |
| **P3 — guide + skills** | devx / skills · S | The three-way rule and the partner stance (D10), the write-back answer (D5), and `SYNC_ARCHITECTURE.md` and the skills pointing at `mapping` / `job`, never at the retired vocabulary. | `Clause-②: no`. `Metadata-protocol: none`. | after P2 engine |
| **P3 — warehouse drivers** | `domain:server`, or a partner · M each | Snowflake and BigQuery plugin driver packages, verified by the conformance kit with the pull-path cases (D1). Where they live is the maintainer's call when this row is filed. | Per package. | after P2 engine |

**Workload, re-estimated.** The epic's estimate (P2 ≈ 5–8 agent-days, P3 ≈ 3–4) predates four additions: the reader
beneath the floor, `sys_sync_run` with a committed read position, D11's bridge, and three drift arms. Re-estimated:
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
  - a `synced` object's `userActions` cannot open a write (D4).

  The children declare each one.
- **A plugin driver's row cap no longer bounds a pull.** One system-only reader runs beneath the floor, on verified
  keyset batches. Every member and federated read keeps the floor (D1).
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
- **Read a warehouse through the floor in keyset batches**: the floor sends cap + 1 whatever the batch limit, so any
  predicate matching more than the cap is refused; a table above 10,000 rows could never be pulled. Not taken (D1).
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
- ⛔ Any vendor driver or connector; where the warehouse driver packages live (the P3 warehouse-drivers child, D1).

**Open points left to the engine child**, each to be decided in its PR and said there:

- the reader-private binding's name and its isolation from the object registry (D1);
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
