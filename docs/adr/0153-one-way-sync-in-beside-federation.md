# ADR-0153: One-way sync-in beside federation — a connector, a federated datasource or a warehouse fills an ordinary object marked `synced`, read-only to members, written back only through declared actions

**Status**: Proposed (2026-11-10). `docs/adr/` is Tier H (Prime Directive #14): this record becomes **Accepted** by the maintainer's merge or an authorised approval. **This record declares; it implements nothing**: no schema, no code, no changeset. The child cards under [Children the epic files on acceptance](#children-the-epic-files-on-acceptance) are filed by the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763) after acceptance and ⛔ never before it. · **Amends** [ADR-0015](./0015-external-datasource-federation.md) §2.2 by one dated note: its non-goals point mirrors at the retired `DataSync`, and now point here.

- **Date**: 2026-11-10
- **Card**: [#31780](https://github.com/objectstack-ai/objectstack/issues/31780) (p1, `domain:spec`), the P1 child of the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763). Its "Decisions the ADR must take" list, D1–D10 with a default each, is this record's skeleton; where a decision below departs from the card's default, the decision says so and why.
- **Decided by**: the maintainer, 2026-11-09, on the epic, verbatim and untranslated. This record executes the rulings as recorded; ⛔ none is re-opened here.
  - **Letter A** — ruling record [`6731568115`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6731568115): 「立专题卡」 at 03:25Z and 「同意你的意见」 at 03:26Z, taking the analysis's recommendation as a whole: one-way sync-in becomes a platform capability beside federation, scoped to sync-in, a provenance marker and write-back only through declared actions; the sync kernel ships in this repository under Apache-2.0; the existing `mapping` / `job` keys are extended and the `DataSyncConfig` / `ETLPipeline` vocabulary is not revived; no bidirectional sync, no conflict merge, no edits overlay.
  - **Amended** — record [`6731744658`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6731744658): 「Palantir 的核心能力我们都应该要有，不等客户需求」 (03:32Z); 「数据管道与加工（Pipeline Builder 类） 你不是说我们不做吗」 (03:33Z) — pipelines and transforms are not built here, warehouse and ETL vendors are partners, and their warehouses are first-class pull sources. The card's ruling line carries the same turn as 「数据仓库类的公司就是我们的合作伙伴」.
  - **Edition split** — record [`6738924490`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6738924490), 「同意」 at 11:23Z: the open edition holds "**the sync-in kernel** (database-source reader, paging, delete policy, provenance columns, `synced` bucket — this epic)"; record-level lineage is Enterprise and lives in the private repository (cloud#4163). The record [`6732372274`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6732372274) was withdrawn as a ruling by [`6732391136`](https://github.com/objectstack-ai/objectstack/issues/31763#issuecomment-6732391136) and is not relied on.
- **Key names** are the `domain:spec` seat's under the maintainer's standing rule; the card's working names stand as this record's proposed spelling.
- **Builds on**: [ADR-0015](./0015-external-datasource-federation.md) (federation, `external_catalog`, the 2026-11-03 organization-scope note), [ADR-0062](./0062-external-datasource-runtime.md) (the datasource connection service a pull reads through), [ADR-0049](./0049-no-unenforced-security-properties.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (declared ⇒ enforced; a rule ships with the runtime line that makes it true), [ADR-0103](./0103-managedby-write-policy-and-engine-write-guard.md) (buckets, the engine write guard, and the 2026-07-20 addendum that made a new bucket safe), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) (no NULL organization; D7 deployment-level state; D9 the refused stamp), [ADR-0073](./0073-automation-execution-identity.md) (execution identity; D3 attribution is not ownership), [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md) (a delete stays physical, the recycle bin is a separate store), [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md) (a connector's credential), [ADR-0057-system-data-lifecycle-and-retention](./0057-system-data-lifecycle-and-retention.md) (retention).
- **Leaves unchanged**: federation as ADR-0015 decides it (a virtual object stays the answer for live, computed or must-not-land data); the import door and its mapping semantics; a connector's actions and the flow `connector_action` node; `job` schedules and the job ledger; every existing bucket's affordances; the retirement entries `etl-pipeline-layer-retired` and `connector-sync-keys-retired`, whose ENFORCE route this record walks rather than reverses.
- **Consumers**: `@objectstack/spec` (`mapping`, `job`, `managedBy`, the injected-columns plan), `@objectstack/service-automation` (the pull executor), `@objectstack/core` (the import runner), `@objectstack/runtime` (the job binder and its boot refusal), `@objectstack/plugin-security` (the bucket's write guard), `@objectstack/platform-objects` (the run record), `@objectstack/lint`, `ui/` (the bucket union, the Studio wizard, read-only rendering), `content/docs` and `skills/`.

---

## Provenance

1. **Decision card** (triage, 2026-11-09T03:02Z, kept in the epic body): the maintainer's 「我就是想做 palentir 开源替代方案，立决策卡」, options A / B / C, with A recommended.
2. **Ruling A** `6731568115` and its amendments `6731744658` and `6738924490`, quoted above.
3. **P0 measurement** [#31778](https://github.com/objectstack-ai/objectstack/issues/31778), os-dev report [`6732731853`](https://github.com/objectstack-ai/objectstack/issues/31778#issuecomment-6732731853): the existing pull path (a `rest` connector, `mapping.connectorSource`, `job.pull`) run end to end on a production-mode `os serve` at `c2bb879f`, one reading per gap G1–G9. [Current state](#current-state-g1g9) is written from it and re-read on `origin/main` `c9246279`.
4. **This card**, claimed for `domain:spec#2` in [`6754703995`](https://github.com/objectstack-ai/objectstack/issues/31780#issuecomment-6754703995).

---

## TL;DR

1. **Sync-in is a second way in, beside federation, not a replacement for it.** A remote table or API collection becomes an ordinary object whose rows were **copied** by a pull. Every platform surface (permissions, RLS, reports, datasets, flows, MCP, AI) reads it as it reads any object. Federation stays the answer when a copy would be wrong ([D10](#d10--the-three-way-rule-and-the-partner-stance)).
2. **Three sources, one binding home.** `mapping.connectorSource` (a `rest` / `openapi` connector) stays; a sibling `mapping.datasourceSource { datasource, remoteName, remoteSchema?, watermark? }` makes any federated datasource a pull source, a warehouse included; exactly one source per mapping ([D1](#d1--pull-sources-a-sibling-datasourcesource-beside-connectorsource)).
3. **A pull reads every page.** A declared `paging { style, param, nextPath }` on the connector source; ordered batches on the datasource source; the starting point of the next pull is the watermark a pull has **committed** ([D2](#d2--paging-every-page-is-read-the-watermark-advances-only-when-committed)).
4. **A source delete is marked, never applied.** `deletePolicy: 'mark' | 'ignore'`, default `mark`, stamping `_sync_deleted_at` ([D3](#d3--deletes-mark-or-ignore-never-a-physical-delete)).
5. **`managedBy: 'synced'`** marks the object: read-only to members at the write guard and in the Console, five platform columns under the reserved `_sync_` prefix, no person owner. A mapping that carries a source must target a `synced` object ([D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns)).
6. **Write-back is a declared action** that calls the source; the next pull brings the change home. No bidirectional sync, no merge, no overlay ([D5](#d5--write-back-only-through-declared-actions)).
7. **Drift refuses the pull**, judged against the federation catalog, the OpenAPI operation's declared response, or the records themselves ([D6](#d6--drift-a-mapped-source-column-that-is-gone-refuses-the-pull)).
8. **One run record per pull**, `sys_sync_run`, organization-owned, beside the job ledger ([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)).
9. **A pull runs as the system, in a declared organization**; under a walled posture a pull job that names none is refused by name at boot ([D8](#d8--execution-identity-and-organization)).
10. **Open source, Apache-2.0** (ruled, [D9](#d9--open-source-placement-ruled)). **Transforms are the partners' job**, and the guide says so ([D10](#d10--the-three-way-rule-and-the-partner-stance)).
11. **Studio may create a pull job**, the one job shape a runtime writer can name ([D11](#d11--the-studio-door-a-runtime-pull-job)).

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
The ETL layer before it left because nothing ran it, and its retirement entry names the way back: "It returns through
the ENFORCE route: the engine first, the vocabulary second"
(`packages/spec/src/migrations/entries/semantic/17.etl-pipeline-layer-retired.ts`). This record extends the pull that
runs; it revives nothing that did not.

### Current state (G1–G9)

The P0 report measured each gap live at `c2bb879f`. Re-read on `origin/main` `c9246279` for this record, four of the
report's out-of-scope findings have since landed on `main`; the table carries both readings, and the decisions below
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
- **The reader is the datasource's own driver**, through the connection service (ADR-0062 D1): a `find` addressed by
  `remoteSchema` and `remoteName`, selecting the source columns `fieldMapping` names. No federated object is declared
  for it; the pull only reads, so the datasource's write gate (ADR-0015 gate 3) is never asked.
- **A managed datasource is refused as a source.** Its objects are already local; a pull from it would make a second
  copy of rows the platform already owns.
- **A warehouse is a datasource like any other.** The pull reads it through whatever driver serves its dialect. The
  SQL driver's dialects serve today; a Snowflake or BigQuery warehouse is served by its driver package, which per the
  #27261 close-out [`6523503305`](https://github.com/objectstack-ai/objectstack/issues/27261#issuecomment-6523503305)
  is vendor-specific and lives outside this repository, verified by the plugin-driver conformance kit
  (`packages/objectql/src/plugin-driver-conformance.ts#definePluginDriverConformanceSuite`). The type matrix already
  names both dialects (ADR-0015 §4.6). The engine card owes a dialect-neutral reader and its conformance cases; it
  owes no vendor driver.
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
paging: { style: 'page' | 'cursor' | 'offset', param: 'page', nextPath: 'body.next' }
```

- `page` sends `param` = 1, 2, …; `offset` sends `param` = the count of records read so far; `cursor` sends `param`
  = the value read at `nextPath` in the previous response. `nextPath` is required for `cursor` and optional for the
  other two, where it names the response's "more pages" marker; without it a pull stops at the first page that
  carries no records.
- A cursor that repeats the previous one refuses the pull (`paging_cursor_repeated`) rather than looping.
- With no `paging`, a pull keeps today's one-response reading, and the `watermark` describe keeps saying so.

**Datasource source.** The reader reads ordered batches: ascending by the watermark field, then by the source key,
`limit` / `offset` at the import runner's batch size. It needs no declaration.

**The starting point is a committed watermark.** Today's starting point is the highest value already written to the
target (the executor's W1 read). It becomes the highest watermark a pull has **committed**, stored on the run record
([D7](#d7--the-run-record-sys_sync_run-beside-sys_job_run)):

- a **datasource source** reads in ascending watermark order, so it commits after each written batch, and an
  interrupted pull resumes from its last batch;
- a **connector source** cannot see the source's order, so it commits once, after its last page. An interrupted
  connector pull re-reads from the previous commit, and the upsert makes the re-read idempotent. This closes the
  newest-first loss the `watermark` describe warns about.

*Departure from the card's default:* "the watermark is committed per batch" holds for the datasource source only.
Committing per page on a source whose order the platform cannot see would advance past pages it never read.

### D3 — Deletes: mark or ignore, never a physical delete

Each source block gains `deletePolicy: 'mark' | 'ignore'`, default `mark`.

- **`mark`** stamps the platform column `_sync_deleted_at` ([D4](#d4--provenance-the-synced-bucket-and-the-_sync_-columns))
  on a row the source no longer has, and clears it if the row comes back. Two detections:
  - a **full** pull (no `watermark`) marks every row of this mapping that a completed pull did not read; an
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
  (`packages/spec/src/data/object.zod.ts#resolveCrudAffordances`). `userActions` may not open a write verb on a
  `synced` object: one writer per row is the point of the bucket, and G5 measured what a second writer does.
- `synced` joins the engine write guard's set (`packages/plugins/plugin-security/src/system-write-guard.ts#assertEngineOwnedWriteAllowed`),
  so a member's generic write is refused `403`. The pull writes as the system and passes by construction.
- **Declared actions write.** An action's script body runs as the system
  (`packages/spec/src/ui/action.zod.ts#ActionSchema`, the `body` note), so a declared action may write a synced row;
  the declarative `type: 'update'` row write runs as the caller and is refused like any member edit. Write-back to the
  source is [D5](#d5--write-back-only-through-declared-actions)'s.
- **A sourced mapping targets a `synced` object.** A `mapping` carrying `connectorSource` or `datasourceSource` whose
  `targetObject` is not `synced` is refused at build, and its `mode` must be `upsert` with an `upsertKey`: a pull that
  cannot match a row again would duplicate it on every run. Measured before deciding: no `mapping` in `examples/`
  on `c9246279` or in `objectstack-ai/hotcrm` at `235106f` carries a `connectorSource`, so no known producer is
  narrowed; per the startup-stage axis the rule lands at once, with no warning window.
- *Why a bucket and not `engine-owned` plus columns.* The bucket is the one key the guard, the affordance matrix, the
  injected-columns plan and the Console already branch on, and `engine-owned` means rows of no business value. The
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
- **The prefix is reserved.** An author field whose name starts `_sync_` is refused on any object. The underscore
  keeps the platform's columns apart from an author's own `synced_at` or `external_id`, which the P0 probe itself
  declared.
- **FLS.** The columns are read-only at every door and the pull is their only writer. They are readable wherever the
  row is, and field-level security may hide them like any field.
- **No person owner.** Pulled rows are attributed by `_sync_run_id`, never owned by the system: ADR-0073 D3 decouples
  attribution from ownership, so automation does not own the rows it writes. The plan injects no `owner_id` and no `owning_business_unit_id` on a
  `synced` object; its `sharingModel` defaults to `public_read`, and `private` without a sharing rule that grants read
  is warned at author time, because an owner-scoped model over owner-less rows reads to no member (G4). Object
  permissions stay configured locally from zero, as the ruling says: a member reads synced rows only through a grant.

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
  introspection.
- **`openapi` connector source:** against the read operation's declared response, which the connector builds from the
  document at registration (`packages/connectors/connector-openapi/src/openapi-connector.ts#buildOutputSchema`), at
  `recordsPath`.
- **`rest` connector source, or a source that declares no shape:** a mapped source field absent from **every** record
  of a non-empty pull refuses it. Absence on some records stays row data.
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
the job ledger's.

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
- **Under the `isolated` and `group` postures, a `job` whose `pull` names a mapping must declare `organization`, or the
  boot is refused by name** — ADR-0015's 2026-11-03 rule for external objects, applied the same way. Today the binder
  splits by posture (`packages/runtime/src/app-artifact-handlers.ts#judgeJobPull`: not scheduled at `error` under
  `isolated`, run with no organization at `warn` under `group`), and an undeclared pull under `group` then fails every
  write at ADR-0131 D9. Work wanted in several organizations is one job per organization; a pull is never fanned out.
- A source carries no organization of its own: the datasource is environment-scoped (ADR-0015 §10), and the
  connector's credential is organization-shared (ADR-0143). The pull reads the source as configured and writes into
  the job's organization.

### D9 — Open-source placement (ruled)

Recorded, not re-opened: the sync kernel — the `mapping` / `job` / pull executor, a datasource as a pull source,
paging, the delete policy, the provenance columns and the `synced` bucket — ships in this repository under
Apache-2.0, as federation does (`6731568115`; the edition table of `6738924490`). Vendor-specific drivers and
connectors stay outside this repository (#27261 close-out). Record-level lineage is Enterprise and is not this
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

*Added beside the card's D1–D10, because G8 cannot close without it.* `job` is code-only today because a runtime
writer cannot name a handler (`DEFAULT_METADATA_TYPE_REGISTRY`'s note: "Re-opening this type means designing a
handler a runtime writer can actually name"). A `pull` job names no handler: it names a `mapping`, which a runtime
writer can already create. So the runtime door accepts a `job` whose only run form is `pull`, and refuses a `body` or
a `handler` there. The Studio sync wizard creates the `synced` object, the `mapping` and that `job`, and every other
job stays code-only.

---

## Children the epic files on acceptance

Filed by the epic [#31763](https://github.com/objectstack-ai/objectstack/issues/31763) after this record is accepted;
⛔ none is filed by this record.

| Child | Lane · size | Scope | Order |
|:--|:--|:--|:--|
| **P2 — engine** | `domain:server` · M–L | the datasource reader (D1); the paging loop and the committed watermark (D2); delete marking (D3); provenance stamping, `synced` in the guard's set, the owner-less plan row (D4); drift on the pull path (D6); `sys_sync_run` and its writer, the end-of-pull log line, the interrupted-run close (D7); the walled-posture boot refusal (D8); the pull-path conformance cases | first |
| **P2 — spec** | `domain:spec` · S–M | `datasourceSource`, `paging`, `deletePolicy`, `deletedField`, `managedBy: 'synced'`, the `_sync_` reserved prefix, the exclusive-source and sourced-target refinements, `job.pull` over either source, the runtime pull job (D11); liveness rows graded `live` against P2 engine's readers; the `ui/` bucket union; `CONNECTOR_SOURCE_NO_POLICY`'s `deleteMode` guidance re-pointed at `deletePolicy`. `Metadata-protocol: narrowed` — the sourced-target rule narrows, the keys add | after P2 engine, or in the same PR where a slice cannot be proven without the key parsing |
| **P3 — Studio** | ui · M | the sync wizard beside the virtual-object one (`offersSync`'s page): source, remote table or operation, field map, cadence, organization; read-only rendering of `synced` objects; run history (D7) | after P2 |
| **P3 — guide + skills** | devx / skills · S | the three-way rule and the partner stance (D10); the write-back answer (D5); `SYNC_ARCHITECTURE.md` and the skills pointing at `mapping` / `job`, never at the retired vocabulary | after P2 |

Workload: P2 ≈ 5–8 agent-days, P3 ≈ 3–4 (the epic's estimate). **Order:** the epic's table puts P2 spec before P2
engine; this record reverses it, on the governing text: the ENFORCE route is "the engine first, the vocabulary
second" (`packages/spec/src/migrations/entries/semantic/17.etl-pipeline-layer-retired.ts`), and a key ships only with the runtime line that makes it true (ADR-0078
§6). The engine reads stored shapes, as `pullConnectorSource` already reads a stored mapping, so its readers are
provable before the authoring door opens; P2 spec then opens the door with ledger rows that cite them.

---

## Consequences

- A synced object is an ordinary object to every reader: datasets, reports, the MCP `query` tool and flows need no
  change, which is the epic's done-when.
- Members cannot edit pulled rows, so the silent keep-or-overwrite of G5 is gone; the change to source data goes
  through a reviewed action.
- A pull reads every page and resumes from a committed point; a source delete and a dropped column are visible
  (a mark, a refused run), never silent.
- **Narrowing for authors:** a sourced mapping must target a `synced` object in `upsert` mode, and `_sync_` is a
  reserved field prefix. No known producer is affected (measured above); the P2 spec card declares it.
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
- ⛔ Any vendor driver or connector.

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
  [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md).
- `packages/spec/src/migrations/entries/semantic/17.etl-pipeline-layer-retired.ts`,
  `packages/spec/src/migrations/entries/semantic/18.connector-sync-keys-retired.ts` — why the old layers left, and the
  way back.
