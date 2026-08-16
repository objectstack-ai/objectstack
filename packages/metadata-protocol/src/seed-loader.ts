// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IMetadataService, ISeedLoaderService } from '@objectstack/spec/contracts';
import type {
  SeedLoaderRequestParsed,
  SeedLoaderResultParsed,
  SeedLoaderConfig,
  SeedLoaderConfigParsed,
  ObjectDependencyGraphParsed,
  ObjectDependencyNodeParsed,
  ReferenceResolutionParsed,
  ReferenceResolutionError,
  SeedLoadResultParsed,
  Seed,
} from '@objectstack/spec/data';
import { SeedLoaderConfigSchema, isMultiValueField } from '@objectstack/spec/data';
import { resolveSeedRecord } from '@objectstack/formula';
import { bulkWrite, withTransientRetry, defaultIsTransientError, type BulkWriteRowResult } from '@objectstack/core';
// [#8442] The repo's ONE recogniser for "this throw is a record-validation
// failure" — duck-typed on `code`/`name`, the same predicate `mapDataError` and
// both dispatcher error exits use. Imported rather than re-spelled so the seed
// channel and the HTTP boundaries cannot drift about what counts as one.
import { validationFailureDetails } from '@objectstack/types';
// [#8896] The platform's ONE answer to "did this READ fail because the table
// has not been provisioned yet?" — the same predicate `DatabaseLoader` (#5108),
// `SysMetadataRepository` (#4867) and `cascadeDeleteRelations` (#8895) ask, so
// a driver quirk is taught to the platform once instead of per seam.
import { isMissingTableError } from '@objectstack/metadata/errors';

interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, error?: Error, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

/** Default field used for externalId matching on target objects */
const DEFAULT_EXTERNAL_ID_FIELD = 'name';

/**
 * [#8442] What a seed `errors[].message` says when the caught sentence may NOT
 * be quoted. Names the operation and points at the log; quotes nothing.
 */
const WITHHELD_WRITE_REASON =
  'the data engine rejected the write; the reason is in the server log';

/**
 * [#8442] Whether a caught error DECLARED itself a client-facing refusal, and
 * may therefore have its sentence quoted back into `errors[].message`.
 *
 * ## Which question this sink asks
 *
 * `errors[].message` is free text — no catalog bounds it — so this is #8333's
 * question ("did the producer AUTHOR this sentence for a caller?"), NOT #8441's
 * membership question, which belongs to `code` because that field writes a
 * closed union (ADR-0112 D4). Same question, one file over.
 *
 * ## …and why the ANSWER needs a second declaration shape
 *
 * `protocol.ts`'s {@link declaresClientRefusal} answers it with a numeric 4xx
 * `status` alone, because every refusal reaching ITS collectors declares one
 * (the repository's `ITEM_LOCKED` 403, `VERSION_NOT_FOUND` 404, …). This sink
 * receives a population those collectors never see: the **data engine's
 * validation layer**. Measured on `main`, an `@objectstack/objectql`
 * `ValidationError` carries own properties `[stack, message, code, name,
 * fields]` — `code = 'VALIDATION_FAILED'` and deliberately **no `status`**,
 * because (per `@objectstack/types`' `validation-failure.ts`) "deciding it
 * means 400 is the job of whichever boundary serves it". For the seed channel,
 * THIS is that boundary.
 *
 * So the 4xx test alone would withhold exactly the sentence a seed author
 * needs. That is not a hypothetical loss of nuance: on this producer the
 * structured keys do NOT carry the offending field. `buildWriteError` reports
 * `field: '(write)'` and `targetField`/`attemptedValue` = the record's
 * EXTERNAL key ("which row"), so "which key was rejected and why" — `plan`,
 * `max_length` — survives only inside the validation sentence. Blanking it
 * would trade the authoring surface for the disclosure, the trade #8441
 * explicitly refused and this card's own warning names.
 *
 * `VALIDATION_FAILED_STATUS = 400` is the repo already stating that a
 * validation failure IS a 4xx client refusal that merely omits the property, so
 * admitting it here widens no boundary — it reads the declaration the error
 * actually makes. A driver fault (`SQLITE_ERROR`, `errno`) matches neither
 * shape and is withheld.
 */
function declaresSeedClientRefusal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return true;
  // A record-validation failure declares itself by SHAPE rather than status.
  return validationFailureDetails(err) !== undefined;
}

/**
 * [#8442] The client-facing tail of a seed failure message — the caught
 * sentence when {@link declaresSeedClientRefusal} admits it, otherwise
 * `undefined` so the caller gets {@link WITHHELD_WRITE_REASON} instead.
 */
function quotableSeedFailureDetail(err: unknown): string | undefined {
  if (!declaresSeedClientRefusal(err)) return undefined;
  const declared = (err as { message?: unknown } | null | undefined)?.message;
  return typeof declared === 'string' && declared.length > 0 ? declared : undefined;
}

/** The caught sentence, whole — for the LOG, which never withholds. */
function seedFailureCause(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.length > 0 ? message : String(err);
}

/**
 * [#8442] How a log line labels the cause it is about to print: marked when the
 * payload half withheld that sentence, plain when the caller received it too.
 *
 * The marker is the half of the operator story that is not about the text. An
 * operator reading `Cause: …` and an operator reading
 * `Cause (withheld from the seed response): …` are looking at the same
 * sentence and a DIFFERENT support situation — in the second the reporter never
 * saw it, so "what did the response say?" has a different answer than the log
 * suggests. Both passes share this one vocabulary so the two halves of the file
 * cannot drift into answering that question differently.
 */
function seedCauseLabel(err: unknown): string {
  return quotableSeedFailureDetail(err) === undefined
    ? 'Cause (withheld from the seed response)'
    : 'Cause';
}

/**
 * [#8442] The operator half. The log line always carries the caught sentence,
 * even when the payload may not quote it — without this, withholding the text
 * would be indistinguishable from DELETING the diagnostic, which is what makes
 * a disclosure fix a net loss for whoever has to fix the database.
 */
function seedFailureLogLine(payloadMessage: string, err: unknown): string {
  const cause = seedFailureCause(err);
  return payloadMessage.includes(cause)
    ? `[SeedLoader] ${payloadMessage}`
    : `[SeedLoader] ${payloadMessage} ${seedCauseLabel(err)}: ${cause}`;
}

/** The environments a seed dataset can be scoped to — mirrors `SeedSchema.env`. */
type SeedEnv = 'prod' | 'dev' | 'test';

/** Every environment a dataset can declare — i.e. `SeedSchema.env`'s default. */
const ALL_SEED_ENVS: readonly SeedEnv[] = ['prod', 'dev', 'test'];

/**
 * `NODE_ENV` spellings accepted for each seed environment.
 *
 * `NODE_ENV` is this repo's ONE established environment source — `os start`
 * defaults it to `production`, `os dev` / `serve --dev` set `development`,
 * vitest sets `test`, and every other environment-sensitive behaviour here
 * (auto-DDL, the sqlite step-down, the hot-reload seeder) already branches on
 * it — the api-registry production guard this list used to cite went with the
 * ApiRegistry retirement (#4939). Seeds reuse it rather than
 * minting an `OS_SEED_ENV`, which would only trade one declared-but-unset key
 * for another.
 *
 * The seed-enum spellings (`prod`/`dev`) are accepted alongside Node's
 * canonical ones so an operator who read the `Seed.env` docs and exported
 * `NODE_ENV=prod` gets what they meant instead of an indeterminate answer.
 * This is normalization of an OPERATOR-supplied variable at a third-party
 * boundary (Prime Directive #9 lists `NODE_ENV` as exactly that), not
 * consumer-side tolerance of our own metadata contract.
 */
const NODE_ENV_TO_SEED_ENV: Readonly<Record<string, SeedEnv>> = {
  production: 'prod',
  prod: 'prod',
  development: 'dev',
  dev: 'dev',
  test: 'test',
};

/**
 * Resolve the environment `Seed.env` is gated on from `NODE_ENV`.
 *
 * Returns `undefined` when `NODE_ENV` is unset or names no seed environment
 * (`staging`, `qa`, …) — i.e. the host never said where it is running. What
 * that means for scoped datasets is decided in {@link SeedLoaderService.load}.
 */
function resolveSeedEnvFromNodeEnv(): SeedEnv | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.NODE_ENV;
  if (typeof raw !== 'string') return undefined;
  return NODE_ENV_TO_SEED_ENV[raw.trim().toLowerCase()];
}

/**
 * Does this dataset apply to `env`?
 *
 * A dataset carrying no `env` at all is unrestricted — which is precisely what
 * `SeedSchema.env`'s default (`['prod','dev','test']`) parses to. Every
 * production call site parses its request through `SeedLoaderRequestSchema`
 * first, so this only covers an in-process caller handing the loader an
 * unparsed literal: it gets the schema's own answer rather than a second
 * dialect of it.
 */
function datasetAllowsEnv(dataset: Seed, env: SeedEnv): boolean {
  const declared = dataset.env as string[] | undefined;
  if (!Array.isArray(declared)) return true;
  return declared.includes(env);
}

/**
 * True when a dataset NARROWED its scope below the schema default — the only
 * datasets for which a resolvable environment changes anything, and therefore
 * the only ones worth warning about when it cannot be resolved.
 */
function isEnvScopedDataset(dataset: Seed): boolean {
  const declared = dataset.env as string[] | undefined;
  if (!Array.isArray(declared)) return false;
  return ALL_SEED_ENVS.some(e => !declared.includes(e));
}

/**
 * SeedLoaderService — Runtime implementation of ISeedLoaderService
 *
 * Provides metadata-driven seed data loading with:
 * - Automatic lookup/master_detail reference resolution via externalId
 *   (in-memory for records seeded this load, DB probe by the target
 *   dataset's declared externalId otherwise)
 * - Topological dependency ordering (parents before children)
 * - Multi-pass loading for circular references
 * - Dry-run validation mode
 * - Upsert support honoring SeedSchema mode
 * - Idempotent replay: an upsert/update whose declared fields already match
 *   the existing row is skipped (no update_at churn, no re-validation) —
 *   seeds replay on every dev-server boot and package re-publish
 * - Actionable error reporting
 *
 * Replay safety invariant: a reference that cannot be resolved is NEVER
 * written as NULL (or as its raw natural-key string) over an existing row —
 * resolution failures either leave the column untouched (deferred to pass 2)
 * or drop the record loudly. See the 15.1.x replay corruption incident:
 * every restart used to sever one lookup per replayed child record.
 */
export class SeedLoaderService implements ISeedLoaderService {
  private engine: IDataEngine;
  private metadata: IMetadataService;
  private logger: Logger;
  /**
   * Tenant org to stamp BUSINESS seed rows with when the caller pinned no
   * explicit `config.organizationId` (resolved per {@link resolveSoleOrganizationId}).
   * Set once per {@link load}; never applied to `sys_`/`cloud_`/`ai_` platform
   * seeds (those stay intentionally global/cross-tenant).
   */
  private fallbackOrgId?: string;
  /**
   * Roll-up summary values left stale so far in the CURRENT {@link load} —
   * bumped by {@link reportStaleSummaries}, sampled by {@link loadDataset}
   * around each dataset so every result entry reports only its own share
   * (two datasets may target the same object, so keying by object name would
   * double-count).
   *
   * An instance field for the same reason {@link fallbackOrgId} is one: the
   * write path that discovers this is several private methods below the point
   * the per-dataset counters live, and threading a callback through
   * `writeRecord` would put plumbing in five call sites to carry one number.
   * Reset per `load`; datasets are loaded strictly sequentially (`for … await`),
   * so the sampling is exact.
   */
  private summariesStale = 0;

  constructor(engine: IDataEngine, metadata: IMetadataService, logger: Logger) {
    this.engine = engine;
    this.metadata = metadata;
    this.logger = logger;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  async load(request: SeedLoaderRequestParsed): Promise<SeedLoaderResultParsed> {
    const startTime = Date.now();
    // Pin the environment `Seed.env` is gated on BEFORE anything reads config.
    // Resolving it here — the one funnel every seeding path goes through — is
    // deliberate. `env` stayed authorable, defaulted and type-checked while
    // being completely inert purely because none of the six call sites that
    // build a SeedLoaderRequest (app boot, per-org replay, hot reload, package
    // apply, draft publish, marketplace install) ever passed it, so
    // `filterByEnv` short-circuited on `undefined` and `dataset.env` was never
    // read at all. Gating at those call sites instead would leave call site
    // seven free to re-open the same hole (framework#4704).
    const config = this.resolveEnvConfig(request.config, request.seeds);
    const allErrors: ReferenceResolutionError[] = [];
    const allResults: SeedLoadResultParsed[] = [];
    // Per-load counter — a service instance can be reused across loads.
    this.summariesStale = 0;

    // When the caller pinned no target org (an in-process publish has no active
    // user session — the AI build agent's publish path), BUSINESS seed rows
    // would land `organization_id = NULL` and then vanish under strict
    // org-scoping. If the tenant has exactly ONE organization, adopt it as a
    // fallback so business seeds carry the tenant key like a normal write.
    // Zero/many orgs → leave unset (genuinely ambiguous → keep the historical
    // global/cross-tenant behavior; the publisher must scope explicitly).
    this.fallbackOrgId =
      config.organizationId == null ? await this.resolveSoleOrganizationId() : undefined;

    // 1. Filter datasets by environment
    const datasets = this.filterByEnv(request.seeds, config.env);

    if (datasets.length === 0) {
      return this.buildEmptyResult(config, Date.now() - startTime);
    }

    // 2. Build dependency graph
    const objectNames = datasets.map(d => d.object);
    const graph = await this.buildDependencyGraph(objectNames);

    this.logger.info('[SeedLoader] Dependency graph built', {
      objects: objectNames.length,
      insertOrder: graph.insertOrder,
      circularDeps: graph.circularDependencies.length,
    });

    // 3. Order datasets by topological insert order
    const orderedDatasets = this.orderDatasets(datasets, graph.insertOrder);

    // 4. Build reference lookup map from metadata (field → target object).
    // Reference values are authored against the TARGET dataset's externalId
    // (e.g. `interview.candidate: 'alice@example.com'` with the candidate
    // dataset declaring `externalId: 'email'`), so DB-side resolution must
    // query that same field — not a hardcoded 'name'. First boot masked this:
    // the in-memory insertedRecords map (keyed by the dataset's externalId)
    // resolved everything, but on replay any per-record miss fell through to
    // the DB probe and silently failed. See the replay corruption fix below.
    const externalIdByObject = new Map<string, string | string[]>(
      request.seeds.map(d => [d.object, d.externalId || DEFAULT_EXTERNAL_ID_FIELD]),
    );
    const refMap = this.buildReferenceMap(graph, externalIdByObject);

    // 5. Pass 1: Insert/upsert records, resolving references
    const insertedRecords = new Map<string, Map<string, string>>(); // object → externalIdValue → internalId
    const deferredUpdates: DeferredUpdate[] = [];

    for (const dataset of orderedDatasets) {
      const result = await this.loadDataset(
        dataset, config, refMap, insertedRecords, deferredUpdates, allErrors
      );
      allResults.push(result);

      if (config.haltOnError && result.errored > 0) {
        // Deliberately `warn`, and audited as such in #4729: this line reports
        // a CONTROL-FLOW decision, not a loss. Every error it halts on was
        // already reported at `error` by the site that counted it, and the
        // datasets skipped after it were never written — the load reports
        // `success: false` and says which object stopped it. Escalating a
        // second line about the same failures is the over-application AGENTS.md
        // warns about (it trains readers to skim `error`).
        this.logger.warn('[SeedLoader] Halting on first error', { object: dataset.object });
        break;
      }
    }

    // 6. Pass 2: Resolve deferred references (circular dependencies)
    if (config.multiPass && deferredUpdates.length > 0 && !config.dryRun) {
      this.logger.info('[SeedLoader] Pass 2: resolving deferred references', {
        count: deferredUpdates.length,
      });
      await this.resolveDeferredUpdates(deferredUpdates, insertedRecords, allResults, allErrors, config.organizationId);
    }

    // 7. Build final result
    const durationMs = Date.now() - startTime;
    return this.buildResult(config, graph, allResults, allErrors, durationMs);
  }

  async buildDependencyGraph(objectNames: string[]): Promise<ObjectDependencyGraphParsed> {
    const nodes: ObjectDependencyNodeParsed[] = [];
    const objectSet = new Set(objectNames);

    for (const objectName of objectNames) {
      const objDef = await this.resolveObjectDefinition(objectName);
      const dependsOn: string[] = [];
      const references: ReferenceResolutionParsed[] = [];

      if (objDef && objDef.fields) {
        const fields = objDef.fields as Record<string, any>;
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          if (
            (fieldDef.type === 'lookup' || fieldDef.type === 'master_detail' || fieldDef.type === 'user') &&
            fieldDef.reference
          ) {
            const targetObject = fieldDef.reference as string;

            // Track dependency ordering only for objects within the graph
            if (objectSet.has(targetObject) && !dependsOn.includes(targetObject)) {
              dependsOn.push(targetObject);
            }

            // Track ALL references for resolution (target may exist in database)
            references.push({
              field: fieldName,
              targetObject,
              targetField: DEFAULT_EXTERNAL_ID_FIELD,
              fieldType: fieldDef.type as 'lookup' | 'master_detail' | 'user',
              // `multiple: true` (lookup/user) stores an ARRAY of ids, so the
              // seed value is an array of natural keys — carried here so
              // resolution knows to map over it instead of rejecting the array
              // as a non-string reference value (framework#3911).
              multiple: isMultiValueField(fieldDef as { type: string; multiple?: boolean }) || undefined,
            });
          }
        }
      }

      nodes.push({ object: objectName, dependsOn, references });
    }

    // Topological sort
    const { insertOrder, circularDependencies } = this.topologicalSort(nodes);

    return { nodes, insertOrder, circularDependencies };
  }

  /**
   * Object definition for reference-graph construction: the metadata service
   * first, then the engine's own schema registry.
   *
   * The engine fallback matters for marketplace-installed packages: their
   * objects are registered through the `manifest` service straight into the
   * ObjectQL registry AFTER `bridgeObjectsToMetadataService` ran at boot, so
   * the metadata service has never heard of them. Resolving only via metadata
   * left the reference graph empty for those objects — every lookup /
   * master_detail seed value was written verbatim (the raw externalId string,
   * e.g. `crm_contact.crm_account = 'Acme Corporation'`) instead of the target
   * record's id. Dangling references break parent joins, and under
   * `sharingModel: controlled_by_parent` RLS that makes the whole object
   * invisible to everyone, admins included.
   */
  private async resolveObjectDefinition(objectName: string): Promise<any> {
    const fromMetadata = (await this.metadata.getObject(objectName)) as any;
    if (fromMetadata?.fields) return fromMetadata;
    try {
      const engineSchema = (this.engine as { getSchema?(name: string): unknown }).getSchema?.(objectName) as any;
      if (engineSchema?.fields) return engineSchema;
    } catch {
      // Engine may not expose a schema registry — the metadata result stands.
    }
    return fromMetadata;
  }

  async validate(datasets: Seed[], config?: SeedLoaderConfig): Promise<SeedLoaderResultParsed> {
    const parsedConfig = SeedLoaderConfigSchema.parse({ ...config, dryRun: true });
    // `datasets` is the AUTHOR state (that is what `validate` takes); `load`
    // takes the parsed request, and `SeedLoaderSchema` fills the per-seed defaults
    // this cast stands in for. Parsing each dataset here would be a second
    // validation pass with its own failure mode — `load` already reports every
    // seed problem it finds, which is the whole point of `dryRun`.
    return this.load({ seeds: datasets, config: parsedConfig } as SeedLoaderRequestParsed);
  }

  // ==========================================================================
  // Internal: Seed Loading
  // ==========================================================================

  private async loadDataset(
    dataset: Seed,
    config: SeedLoaderConfigParsed,
    refMap: Map<string, ReferenceResolutionParsed[]>,
    insertedRecords: Map<string, Map<string, string>>,
    deferredUpdates: DeferredUpdate[],
    allErrors: ReferenceResolutionError[],
  ): Promise<SeedLoadResultParsed> {
    const objectName = dataset.object;
    const mode = dataset.mode || config.defaultMode;
    const externalId = dataset.externalId || 'name';

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;
    let referencesResolved = 0;
    let referencesDeferred = 0;
    /**
     * Reference FIELDS dropped from records that were still written — the
     * "wrote the row, lost the link" outcome. Kept apart from `errored` (which
     * counts dropped RECORDS) so `inserted + updated + skipped + errored`
     * still reconciles against `total`. See framework#3932.
     */
    let referencesDropped = 0;
    /**
     * Roll-up summaries this dataset leaves stale — sampled as a delta on the
     * per-load counter (see {@link SeedLoaderService.summariesStale}) rather
     * than tracked locally, because the write that discovers it is several
     * methods down. Datasets load sequentially, so the delta is exactly this
     * dataset's share even when two datasets target the same object.
     */
    const summariesStaleAtStart = this.summariesStale;
    const errors: ReferenceResolutionError[] = [];

    // Ensure the object's record map exists
    if (!insertedRecords.has(objectName)) {
      insertedRecords.set(objectName, new Map());
    }

    // Pre-load existing records for upsert matching. When a target
    // organization is set, scope the lookup so each tenant gets its
    // own copy (otherwise upsert would clobber other tenants' rows
    // that share the same natural key — e.g. `name: 'Acme Corp'`).
    let existingRecords: Map<string, any> | undefined;
    if ((mode === 'upsert' || mode === 'update' || mode === 'ignore') && !config.dryRun) {
      existingRecords = await this.loadExistingRecords(
        objectName,
        externalId,
        config.organizationId,
      );
    }

    // Get reference resolutions for this object
    const objectRefs = refMap.get(objectName) || [];

    // Self-referencing objects (e.g. `employee.manager_id -> employee`) can
    // have record i reference record j<i from the SAME dataset by natural
    // key; that only resolves via `insertedRecords` once record j has
    // actually been written (see the reference-resolution loop below). Batch
    // writes defer the write past the point the record was resolved, which
    // would break that same-batch ordering — so self-referencing datasets
    // keep the historical strictly-sequential per-record write path
    // (`writeRecord`, unchanged) and opt out of batching entirely. Every
    // other dataset (the overwhelming majority — contact/lead/opportunity/…
    // reference OTHER objects, already fully loaded via topological order)
    // gets the batched path below. See framework#2678.
    const hasSelfRef = objectRefs.some(ref => ref.targetObject === objectName);

    // Records resolved as inserts (mode 'insert'/'replace', or an unmatched
    // upsert/ignore) are buffered here and flushed in batches through the
    // engine's array-form insert() — one round-trip per batch instead of one
    // per record, with transient-error retry and per-row degradation on a
    // logical/validation failure. See framework#2678.
    const pendingInserts: Array<{ recordIndex: number; externalIdValue: string; record: Record<string, unknown> }> = [];
    const opts = SeedLoaderService.SEED_OPTIONS as any;
    const extIdOf = (rec: Record<string, unknown>) => this.externalIdKey(rec, externalId);
    // bulkWrite is at-least-once: a retry (or a mismatch-driven degradation)
    // may re-run a write whose prior attempt already committed. Guard against
    // duplicate seed rows by rechecking natural keys before re-inserting
    // (framework#3149). `lastBatchUncertain` carries the "prior batch outcome
    // unknown" signal into the per-row degradation writeOne calls.
    let lastBatchUncertain = false;
    const isUncertainOutcome = (e: unknown) =>
      defaultIsTransientError(e) || (e as { code?: unknown } | null)?.code === 'ERR_BULK_RESULT_MISMATCH';
    // Partial-success entry (framework#3172): when the engine offers
    // insertMany, a row that fails validation is a final per-row verdict from
    // ONE batch call — bulkWrite never degrades, so beforeInsert hooks run
    // exactly once per row. Feature-detected so a legacy engine (tests, other
    // IDataEngine impls) falls back to the whole-array insert + degradation.
    const engineInsertMany: ((o: string, rows: any[], op: any) => Promise<Array<{ ok: boolean; record?: any; error?: unknown }>>) | undefined =
      typeof (this.engine as any).insertMany === 'function'
        ? (o, rows, op) => (this.engine as any).insertMany(o, rows, op)
        : undefined;
    const flushPendingInserts = async (): Promise<void> => {
      if (pendingInserts.length === 0) return;
      const batch = pendingInserts.splice(0, pendingInserts.length);
      const writeResults: BulkWriteRowResult[] = await bulkWrite(
        batch.map(b => b.record),
        {
          batchSize: SeedLoaderService.BULK_BATCH_SIZE,
          writeBatchPartial: async (rows, { attempt }) => {
            let toInsert = rows;
            let existing = new Map<string, any>();
            if (attempt > 1) {
              // Prior attempt may have committed before its response was lost:
              // insert only rows not already present so a retry can't duplicate.
              existing = await this.loadExistingRecords(objectName, externalId, config.organizationId);
              toInsert = rows.filter((r) => { const k = extIdOf(r); return !(k && existing.has(k)); });
            }
            try {
              let freshOutcomes: Array<{ ok: boolean; record?: any; error?: unknown }>;
              if (toInsert.length === 0) {
                freshOutcomes = [];
              } else if (engineInsertMany) {
                // Partial-success batch: per-row verdicts, hooks fire once.
                // On ERR_SUMMARY_RECOMPUTE, writeRecoveringSummary hands back
                // e.written — which for insertMany IS the outcome array.
                freshOutcomes = await this.writeRecoveringSummary(objectName, () => engineInsertMany(objectName, toInsert, opts));
              } else {
                // Legacy whole-array insert: any bad row throws the batch, and
                // bulkWrite's per-row degradation (writeOne) sorts it out. A
                // lone row keeps the historical bare-record insert() shape.
                const recs = toInsert.length === 1
                  ? [await this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, toInsert[0], opts))]
                  : await this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, toInsert, opts));
                freshOutcomes = (recs as any[]).map((r) => ({ ok: true, record: r }));
              }
              lastBatchUncertain = false;
              // Reassemble one outcome per input row in order: recheck hits use
              // the existing record; the rest consume freshOutcomes in order.
              let k = 0;
              return rows.map((r) => {
                const key = extIdOf(r);
                if (key && existing.has(key)) return { ok: true, record: existing.get(key) };
                return freshOutcomes[k++];
              });
            } catch (e) {
              lastBatchUncertain = isUncertainOutcome(e);
              throw e;
            }
          },
          writeBatch: async () => {
            // Unreachable — writeBatchPartial above takes precedence — but the
            // BulkWriteOptions contract requires it.
            throw new Error('seed-loader uses writeBatchPartial');
          },
          writeOne: async (row, { attempt }) => {
            if (attempt > 1 || lastBatchUncertain) {
              const key = extIdOf(row);
              if (key) {
                const existing = await this.loadExistingRecords(objectName, externalId, config.organizationId);
                const hit = existing.get(key);
                if (hit) return hit; // already committed by a prior attempt
              }
            }
            return this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, row, opts));
          },
        },
      );
      for (const res of writeResults) {
        const { recordIndex, externalIdValue, record } = batch[res.index];
        if (res.ok) {
          inserted++;
          const internalId = this.extractId(res.record);
          if (externalIdValue && internalId) {
            insertedRecords.get(objectName)!.set(externalIdValue, internalId);
          }
        } else {
          errored++;
          const error = this.buildWriteError(objectName, record, externalId, recordIndex, res.error);
          errors.push(error);
          allErrors.push(error);
          // `error`, not `warn` (#4729 / #4632): this row is counted in
          // `allErrors` — the load already reports `success: false` — and the
          // consequence is that the record did NOT land. Count and log level
          // must agree; the message names the row and the cause — [#8442] the
          // cause EXPLICITLY, since the payload half may now withhold it.
          this.logger.error(
            seedFailureLogLine(error.message, res.error),
            res.error instanceof Error ? res.error : undefined,
            { recordIndex },
          );
        }
      }
    };

    // Pin a single `now()` snapshot for the entire dataset so multi-pass
    // loads see one logical clock — the M9 determinism guarantee for seeds.
    const seedNow = new Date();

    // Identity/context bound to seed CEL expressions. `os.user` / `os.org`
    // resolve from here, so `owner_id: cel\`os.user.id\`` works.
    //
    // When no real user identity is supplied (the normal case — seeds run
    // before the first human sign-up), `os.user` is bound to a NULL identity
    // (`{ id: null }`) rather than left undefined. This makes `os.user.id`
    // resolve to `null` instead of crashing the expression, so a seed's
    // `owner_id: cel\`os.user.id\`` simply lands NULL — semantically "owned by
    // whoever becomes the first admin", which the first-admin handoff
    // (`claimSeedOwnership`) then fills in. The platform therefore never has to
    // mint a placeholder `usr_system` row just to satisfy this expression.
    const seedIdentity = config.identity;
    const baseEvalCtx = {
      now: seedNow,
      // `id: null` is a legitimate seed-time state (the owning admin does not
      // exist yet) that the formula EvalContext's `user.id: string` type does
      // not yet model — cast the fallback so `os.user.id` evaluates to null.
      user: seedIdentity?.user ?? ({ id: null } as unknown as NonNullable<typeof seedIdentity>['user']),
      // Fall back to the per-tenant organizationId so `os.org.id` resolves
      // during per-org replay even without an explicit identity.org.
      org: seedIdentity?.org ?? (config.organizationId ? { id: config.organizationId } : undefined),
      env: config.env,
    };

    for (let i = 0; i < dataset.records.length; i++) {
      // Resolve any embedded Expression envelopes (e.g. `cel\`daysFromNow(30)\``,
      // `cel\`os.user.id\``) BEFORE reference resolution so downstream lookups
      // see resolved values.
      const seedResult = resolveSeedRecord(
        dataset.records[i] as Record<string, never>,
        baseEvalCtx,
      );
      if (!seedResult.ok) {
        // LOUD FAILURE: a record whose dynamic values cannot be resolved is
        // dropped — but never silently. Record an actionable error (so it
        // surfaces in result.errors and flips success=false) instead of
        // writing the unresolved Expression envelope into the database.
        errored++;
        const error: ReferenceResolutionError = {
          sourceObject: objectName,
          field: '(expression)',
          targetObject: objectName,
          targetField: '(expression)',
          attemptedValue: dataset.records[i],
          recordIndex: i,
          message:
            `Cannot resolve dynamic seed values for ${objectName} record #${i}: ${seedResult.error.message}. ` +
            '`os.user.id` resolves to null at seed time (the owning admin does not exist yet) and ' +
            'owner-style fields are assigned by the first-admin handoff — so a required, non-owner ' +
            'field must not depend on it. Provide a literal value or make the field optional.',
        };
        errors.push(error);
        allErrors.push(error);
        // `error`, not `warn` (#4729 / #4632): counted in `allErrors` and the
        // record is dropped — nothing of it is persisted.
        this.logger.error(`[SeedLoader] ${error.message}`, undefined, { recordIndex: i });
        continue;
      }
      const record = { ...(seedResult.value as Record<string, unknown>) };

      // Per-tenant tagging: stamp every seeded row with the target org — the
      // caller's explicit `config.organizationId`, or (when none was pinned) the
      // single-org fallback for BUSINESS objects only. A `sys_`/`cloud_`/`ai_`
      // platform seed never takes the fallback: those stay global/cross-tenant.
      // A record that supplies its own `organization_id` always wins; objects
      // without the column ignore the extra key at the engine.
      const tenantOrg =
        config.organizationId ??
        (/^(sys_|cloud_|ai_)/.test(objectName) ? undefined : this.fallbackOrgId);
      // Remember that WE wrote this value, so the reference pass below leaves it
      // alone. `tenantOrg` is an ID by construction — the caller's target org,
      // or a resolved `sys_organization.id` — never a natural key. But
      // `organization_id` is declared as a lookup → `sys_organization`, so the
      // pass would treat the id as a natural key, probe `sys_organization.name`
      // for it, miss, and DROP the column: the row lands org-less and is then
      // invisible to every member behind the tenant wall.
      //
      // The probe cannot rescue it either. `resolveFromDatabase` falls back to
      // an `id` probe, but under per-tenant replay it AND-scopes every probe
      // with `organization_id = <target org>` — and `sys_organization`, being
      // the tenant table itself, carries no such column, so that probe matches
      // nothing by construction.
      //
      // Only better-auth-shaped ids (`org_msbubm8g3j35rgx0`) actually hit this:
      // `looksLikeInternalId` recognises UUID/ObjectId and short-circuits those.
      // Every organization better-auth creates — including the default org
      // `ensureDefaultOrganization` bootstraps — carries the `org_` shape, so in
      // a real multi-org deployment EVERY replayed row landed org-less, while
      // fixtures that mint UUID org ids passed. That asymmetry is why this
      // survived: see `apps/ee-tenant-crm-showcase` in the cloud repo, which
      // reproduces it end-to-end.
      let stampedTenantOrg = false;
      if (tenantOrg && record['organization_id'] == null) {
        record['organization_id'] = tenantOrg;
        stampedTenantOrg = true;
      }

      // Resolve references
      let unresolvedRefError = false;
      for (const ref of objectRefs) {
        // Never re-resolve the tenant stamp we just wrote (see above). A seed
        // that authors `organization_id` ITSELF still goes through resolution,
        // so naming an org by its natural key keeps working.
        if (stampedTenantOrg && ref.field === 'organization_id') continue;
        const fieldValue = record[ref.field];
        if (fieldValue === undefined || fieldValue === null) continue;

        const pushError = (message: string, attemptedValue: unknown): ReferenceResolutionError => {
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: ref.field,
            targetObject: ref.targetObject,
            targetField: ref.targetField,
            attemptedValue,
            recordIndex: i,
            message,
          };
          errors.push(error);
          allErrors.push(error);
          return error;
        };

        /**
         * Report a reference the loader had to DROP — the row still lands, so
         * this is the one failure mode in the file whose row counters stay
         * clean (`errored` never moves; only `referencesDropped` does,
         * framework#3932). That is exactly the shape AGENTS.md → "Degradation
         * log levels" reserves `error` for: the record looks seeded while an
         * association it declared is not there. `warn` here was the same
         * count/level contradiction #4729 fixed in pass 2, so the line states
         * the CONSEQUENCE (row written without the association) and the FIX on
         * top of the authored error's own advice.
         */
        const reportDroppedReference = (error: ReferenceResolutionError): void => {
          this.logger.error(
            `[SeedLoader] ${error.message} The value was DROPPED, so ${objectName} record #${i} was written WITHOUT ` +
              `its \`${ref.field}\` association: the row counters stay clean (only referencesDropped moves), and the ` +
              `link is simply absent. Fix the seed value and re-run the seed to restore it.`,
            undefined,
            { recordIndex: i },
          );
        };

        // LOUD FAILURE: an ARRAY of natural keys is only writable by a field
        // that stores an array — `Field.lookup(..., { multiple: true })` (or a
        // multi `user` field). On a single-value field it can never resolve, so
        // report the actionable fix instead of letting it reach the driver.
        if (Array.isArray(fieldValue) && !ref.multiple) {
          const error = pushError(
            `Invalid reference for ${objectName}.${ref.field}: expected a single ` +
              `${ref.targetObject}.${ref.targetField} natural-key string but got an array. ` +
              `Declare the field as \`multiple: true\` to store several references, ` +
              `or pass one natural key.`,
            fieldValue,
          );
          reportDroppedReference(error);
          // Drop the unwritable value so it never reaches the driver. Removing
          // the key (not writing null) matters on the upsert UPDATE path — see
          // the deferred-reference note below. The row itself still gets
          // written, so this is a dropped FIELD, not a dropped record — counted
          // separately (framework#3932) or every count-driven surface, notably
          // the CLI boot banner, reads clean over a severed association.
          delete record[ref.field];
          referencesDropped++;
          continue;
        }

        // A `multiple: true` field's stored shape IS an array, so a lone
        // natural key is one-element shorthand for it; a single-value field
        // keeps its scalar shape. Either way every element resolves the same.
        const items = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
        const resolvedItems: unknown[] = [];
        let invalidItem = false;
        let unresolvedItem: unknown;
        let sawUnresolved = false;

        for (const item of items) {
          // A null/undefined hole carries no reference — drop it rather than
          // writing it into the stored array.
          if (item === undefined || item === null) continue;

          const outcome = await this.resolveReferenceItem(ref, item, insertedRecords, config);
          if (outcome.status === 'invalid') {
            // LOUD FAILURE: a reference must be a natural-key string (or an
            // internal id). An object value — e.g. the wrapper
            // `{ externalId: 'X' }` — never resolves: it would otherwise fall
            // through unresolved and reach the driver as a non-bindable value
            // ("SQLite3 can only bind ..."). This used to be silently skipped
            // (and only crashed on a persistent DB's update path), so catch it
            // here and report the actionable fix instead.
            const error = pushError(
              `Invalid reference for ${objectName}.${ref.field}: expected a ` +
                `${ref.targetObject}.${ref.targetField} natural-key string but got an object.${outcome.hint}`,
              item,
            );
            reportDroppedReference(error);
            invalidItem = true;
            break;
          }
          if (outcome.status === 'unresolved') {
            unresolvedItem = item;
            sawUnresolved = true;
            break;
          }
          if (outcome.status === 'resolved') referencesResolved++;
          resolvedItems.push(outcome.value);
        }

        if (invalidItem) {
          // Drop the unresolvable value so it never reaches the driver.
          // Removing the key (not writing null) matters on the upsert UPDATE
          // path: an explicit null would overwrite the existing row's valid
          // reference, silently severing the link on every seed replay.
          // Counted as a dropped FIELD (see the array branch above).
          delete record[ref.field];
          referencesDropped++;
          continue;
        }

        if (sawUnresolved) {
          if (config.dryRun) {
            // Dry-run: report the miss but leave the authored value untouched.
            //
            // Deliberately QUIET — no logger call, unlike the real-run branch
            // below (#4997). A dry run writes nothing, so nothing was lost: its
            // caller is by definition reading the result object (that is the
            // whole point of `validate()`), and an `error` line about a
            // SIMULATED outcome is the over-application AGENTS.md → "Degradation
            // log levels" warns about — it trains readers to skim `error`, which
            // is what made the #4420 log unreadable in the first place. Pinned by
            // test so this stays a decision rather than an oversight.
            pushError(
              `[dry-run] Reference may not resolve: ${objectName}.${ref.field} = ` +
                `'${String(unresolvedItem)}' → ${ref.targetObject}.${ref.targetField}`,
              unresolvedItem,
            );
          } else if (config.multiPass) {
            // Defer to pass 2. REMOVE the field rather than writing null:
            // on insert a missing column lands NULL anyway (placeholder until
            // pass 2 back-fills it), but on the upsert UPDATE path an explicit
            // null would OVERWRITE the existing row's already-correct
            // reference — every dev-server restart severed one link per
            // replayed record (NOT NULL columns turned this into a loud
            // constraint error; nullable ones silently lost the association).
            //
            // A multi-value field defers as a WHOLE (the original authored
            // array): a partially-written array is a corrupt association, and
            // pass 2 re-resolves every element from the same authored keys.
            delete record[ref.field];
            deferredUpdates.push({
              objectName,
              recordExternalId: this.externalIdKey(record, externalId),
              externalIdLabel: this.externalIdLabel(externalId),
              field: ref.field,
              targetObject: ref.targetObject,
              targetField: ref.targetField,
              attemptedValue: fieldValue,
              multiple: ref.multiple === true,
              recordIndex: i,
            });
            referencesDeferred++;
          } else {
            // Cannot resolve and no pass 2 will run — skip the whole record.
            // Writing it anyway would either carry the raw natural-key string
            // into the FK column or, on update, corrupt the existing row.
            //
            // LOUD, and now in all three registers: COUNTED (`errored`, below),
            // REPORTED (`result.errors` / `allErrors` → `success: false`) and
            // LOGGED at `error`. Until #4997 the comment here claimed "LOUD:
            // counted + reported" while this path logged nothing at all, so a
            // load that dropped N records was indistinguishable from a clean one
            // in the console — and `packages/runtime`'s seed call sites only
            // `await` the result. `error` is the level AGENTS.md → "Degradation
            // log levels" reserves for exactly this: the boot looks healthy while
            // rows the seed declares are simply not there.
            const error = pushError(
              `Cannot resolve reference: ${objectName}.${ref.field} = '${String(unresolvedItem)}' → ` +
                `${ref.targetObject}.${ref.targetField} not found`,
              unresolvedItem,
            );
            this.logger.error(
              `[SeedLoader] ${error.message}. ${objectName} record #${i} was NOT seeded AT ALL — the WHOLE ` +
                `record is dropped, not just its \`${ref.field}\` link, because writing it would put the raw ` +
                `natural key '${String(unresolvedItem)}' into the FK column (or, on an upsert UPDATE, corrupt ` +
                `the row already there). Nothing retries this: pass 2 is off. Restore the record in one of ` +
                `three ways, then re-run the seed — seed ${ref.targetObject} BEFORE ${objectName} so the ` +
                `target row exists; or enable \`multiPass\` so pass 2 back-fills the reference once every ` +
                `object is loaded; or fix the natural key in the ${objectName} seed data so it names a real ` +
                `${ref.targetObject}.${ref.targetField}.`,
              undefined,
              {
                object: objectName,
                field: ref.field,
                target: `${ref.targetObject}.${ref.targetField}`,
                recordIndex: i,
              },
            );
            unresolvedRefError = true;
          }
          continue;
        }

        // Every element resolved (or was already an internal id). A
        // `multiple: true` field always lands an ARRAY — including when the
        // seed authored a lone key — because that is its stored shape.
        record[ref.field] = ref.multiple ? resolvedItems : resolvedItems[0];
      }

      // A definitively unresolvable reference (no pass 2 to fix it) drops the
      // record — reported above, counted here. Better a missing seed row than
      // a written one with a corrupted or unresolved reference.
      if (unresolvedRefError && !config.dryRun) {
        errored++;
        continue;
      }

      // Insert/upsert the record
      if (!config.dryRun) {
        if (hasSelfRef) {
          // Self-referencing dataset: keep the historical sequential
          // per-record write so a later record can resolve its self-ref
          // against an earlier one via `insertedRecords` — see `hasSelfRef`.
          try {
            const result = await this.writeRecord(
              objectName, record, mode, externalId, existingRecords
            );

            if (result.action === 'inserted') inserted++;
            else if (result.action === 'updated') updated++;
            else if (result.action === 'skipped') skipped++;

            const externalIdValue = this.externalIdKey(record, externalId);
            const internalId = result.id;
            if (externalIdValue && internalId) {
              insertedRecords.get(objectName)!.set(externalIdValue, String(internalId));
            }
          } catch (err: any) {
            errored++;
            // Same cascade guard as the batched update path: the row may
            // already exist (rejected update), so keep its natural-key
            // mapping alive for downstream reference resolution.
            const externalIdValue = this.externalIdKey(record, externalId);
            const existingId = this.extractId(existingRecords?.get(externalIdValue));
            if (externalIdValue && existingId) {
              insertedRecords.get(objectName)!.set(externalIdValue, existingId);
            }
            const error = this.buildWriteError(objectName, record, externalId, i, err);
            errors.push(error);
            allErrors.push(error);
            // `error`, not `warn` (#4729 / #4632): counted in `allErrors`, and
            // the record did not land. `writeRecord` is in the durability
            // gate's vocabulary, so this catch cannot regress to `warn`.
            // [#8442] carries the caught cause even when the payload withholds.
            this.logger.error(
              seedFailureLogLine(error.message, err),
              err instanceof Error ? err : undefined,
              { recordIndex: i },
            );
          }
        } else {
          const decision = this.decideWriteAction(record, mode, externalId, existingRecords);
          const externalIdValue = this.externalIdKey(record, externalId);

          if (decision.action === 'skip') {
            skipped++;
            if (decision.id && externalIdValue) {
              insertedRecords.get(objectName)!.set(externalIdValue, decision.id);
            }
          } else if (decision.action === 'update') {
            // Register the externalId → id mapping BEFORE attempting the
            // write: the row exists and its id is known regardless of whether
            // this update succeeds. A rejected update (e.g. a state_machine
            // rule vetoing the transition back to the seed value) must not
            // sever downstream natural-key resolution — that cascade is what
            // turned one legitimate validation error into NULLed-out child
            // references on every dev-server restart.
            if (externalIdValue) {
              insertedRecords.get(objectName)!.set(externalIdValue, decision.id);
            }
            try {
              await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id: decision.id }, opts)));
              updated++;
            } catch (err: any) {
              errored++;
              const error = this.buildWriteError(objectName, record, externalId, i, err);
              errors.push(error);
              allErrors.push(error);
              // `error`, not `warn` (#4729 / #4632): counted in `allErrors`,
              // and the row's declared values did not land — an upsert that
              // fails here leaves the PREVIOUS row contents in place, which
              // looks like a seeded record and is not one.
              // [#8442] carries the caught cause even when the payload withholds.
              this.logger.error(
                seedFailureLogLine(error.message, err),
                err instanceof Error ? err : undefined,
                { recordIndex: i },
              );
            }
          } else {
            // Insert: buffer for the batched flush rather than writing now.
            pendingInserts.push({ recordIndex: i, externalIdValue, record });
            if (pendingInserts.length >= SeedLoaderService.BULK_BATCH_SIZE) {
              await flushPendingInserts();
            }
          }
        }
      } else {
        // Dry-run: simulate insert tracking
        const externalIdValue = this.externalIdKey(record, externalId);
        if (externalIdValue) {
          insertedRecords.get(objectName)!.set(externalIdValue, `dry-run-id-${i}`);
        }
        inserted++; // Count as "would be inserted"
      }
    }

    if (!config.dryRun) {
      await flushPendingInserts();
    }

    return {
      object: objectName,
      mode,
      inserted,
      updated,
      skipped,
      errored,
      total: dataset.records.length,
      referencesResolved,
      referencesDeferred,
      referencesDropped,
      summariesStale: this.summariesStale - summariesStaleAtStart,
      errors,
    };
  }

  // ==========================================================================
  // Internal: Reference Resolution
  // ==========================================================================

  /**
   * Best-effort resolve the tenant's SOLE organization id — used to stamp
   * business seed rows when the caller pinned no `config.organizationId` (an
   * in-process publish has no active user session). A fresh env has exactly one
   * org, so its seeds should carry it like a normal write instead of landing
   * org-less (→ invisible under strict org-scoping). Returns undefined when
   * there are zero or several orgs (genuinely ambiguous — keep the historical
   * global/cross-tenant NULL) or when `sys_organization` is absent.
   */
  private async resolveSoleOrganizationId(): Promise<string | undefined> {
    try {
      const rows = await this.engine.find('sys_organization', {
        fields: ['id'],
        limit: 2,
        context: { isSystem: true },
      } as any);
      if (Array.isArray(rows) && rows.length === 1) {
        const id = (rows[0] as { id?: unknown; _id?: unknown })?.id ?? (rows[0] as { _id?: unknown })?._id;
        return id ? String(id) : undefined;
      }
    } catch {
      // sys_organization may not exist (single-tenant runtime) — ignore.
    }
    return undefined;
  }

  /**
   * Resolve ONE reference value — the whole value of a single-value field, or
   * one element of a `multiple: true` field's array — against the records
   * seeded so far and then the database.
   *
   * Splitting this out is what lets a multi-value lookup work at all: the
   * authored `authors: ['Alice', 'Bob']` is N independent natural keys, not one
   * unresolvable "object" (framework#3911). Both passes share it so an element
   * deferred to pass 2 resolves by exactly the same rules.
   */
  private async resolveReferenceItem(
    ref: { field: string; targetObject: string; targetField: string },
    value: unknown,
    insertedRecords: Map<string, Map<string, string>>,
    config: { dryRun?: boolean; organizationId?: string },
  ): Promise<
    | { status: 'resolved'; value: string }
    | { status: 'kept'; value: unknown }
    | { status: 'invalid'; hint: string }
    | { status: 'unresolved' }
  > {
    if (typeof value === 'object') {
      const wrapped = (value as Record<string, unknown>).externalId;
      return {
        status: 'invalid',
        hint:
          wrapped !== undefined
            ? ` Pass the natural key directly: ${ref.field}: ${JSON.stringify(wrapped)}.`
            : ` Pass the target's ${ref.targetField} value as a plain string.`,
      };
    }

    // Not a natural key (an internal id, or a non-string the engine will
    // reject on its own terms) — keep it verbatim.
    if (typeof value !== 'string' || this.looksLikeInternalId(value)) {
      return { status: 'kept', value };
    }

    // Records seeded during THIS load first, then existing rows in the DB.
    const fromThisLoad = insertedRecords.get(ref.targetObject)?.get(value);
    if (fromThisLoad) return { status: 'resolved', value: fromThisLoad };

    // Dry-run never probes the database — an in-memory miss is the verdict.
    if (config.dryRun) return { status: 'unresolved' };

    const fromDatabase = await this.resolveFromDatabase(
      ref.targetObject, ref.targetField, value, config.organizationId,
    );
    return fromDatabase ? { status: 'resolved', value: fromDatabase } : { status: 'unresolved' };
  }

  private async resolveFromDatabase(
    targetObject: string,
    targetField: string,
    value: unknown,
    organizationId?: string,
  ): Promise<string | null> {
    // Probe order: the target dataset's declared externalId (threaded in as
    // `targetField` via buildReferenceMap), then the historical 'name'
    // default, then the internal id. Each is exact-match, so extra probes
    // can only rescue a reference, never mis-resolve one.
    const probeFields = [targetField];
    if (targetField !== DEFAULT_EXTERNAL_ID_FIELD) probeFields.push(DEFAULT_EXTERNAL_ID_FIELD);
    if (targetField !== 'id') probeFields.push('id');
    for (const probeField of probeFields) {
      try {
        const where: Record<string, unknown> = { [probeField]: value };
        // Per-tenant replay: when scoping is requested, only consider
        // rows that belong to the target tenant so cross-tenant rows
        // never get borrowed as a "resolved" reference (would silently
        // create a cross-org FK).
        if (organizationId) where.organization_id = organizationId;
        const records = await this.engine.find(targetObject, {
          where,
          fields: ['id'],
          limit: 1,
          context: { isSystem: true },
        } as any);
        // The 'id' probe covers a seed that wires a lookup to a real existing
        // record (e.g. a people field → the current user, whose id is not a
        // UUID/ObjectId so `looksLikeInternalId` did not short-circuit); an id
        // either exists or it does not, so there is no false-match risk.
        if (records && records.length > 0) {
          return String(records[0].id || records[0]._id);
        }
      } catch {
        // Target object (or this probe's column) may not exist — try the next
        // probe rather than aborting resolution outright.
      }
    }
    return null;
  }

  private async resolveDeferredUpdates(
    deferredUpdates: DeferredUpdate[],
    insertedRecords: Map<string, Map<string, string>>,
    allResults: SeedLoadResultParsed[],
    allErrors: ReferenceResolutionError[],
    organizationId?: string,
  ): Promise<void> {
    for (const deferred of deferredUpdates) {
      // A multi-value field deferred its WHOLE authored array (see pass 1), so
      // re-resolve every element here; a single-value field has exactly one.
      const items = Array.isArray(deferred.attemptedValue)
        ? deferred.attemptedValue
        : [deferred.attemptedValue];
      const resolvedItems: unknown[] = [];
      let missingItem: unknown;
      let stillUnresolved = false;

      for (const item of items) {
        if (item === undefined || item === null) continue;
        const outcome = await this.resolveReferenceItem(
          deferred, item, insertedRecords, { organizationId },
        );
        if (outcome.status === 'resolved' || outcome.status === 'kept') {
          resolvedItems.push(outcome.value);
          continue;
        }
        // 'invalid' can't reach pass 2 (pass 1 drops it), but treat it as a
        // miss rather than writing an unresolvable value.
        missingItem = item;
        stillUnresolved = true;
        break;
      }

      // A multi-value field writes the array it re-resolved; a single-value one
      // writes its lone id. An empty result is never a resolution.
      const resolvedValue: unknown = deferred.multiple ? resolvedItems : resolvedItems[0];

      if (!stillUnresolved && resolvedItems.length > 0) {
        // Find the record and update the reference
        const objectRecordMap = insertedRecords.get(deferred.objectName);
        const recordId = objectRecordMap?.get(deferred.recordExternalId);

        if (recordId) {
          try {
            await this.writeDeferredReference(deferred, recordId, resolvedValue);

            // Update result stats
            const resultEntry = allResults.find(r => r.object === deferred.objectName);
            if (resultEntry) {
              resultEntry.referencesResolved++;
              resultEntry.referencesDeferred--;
            }
          } catch (err: any) {
            // LOUD FAILURE (framework#2805; rule: #4632, accident: #4420): the
            // target resolved but the back-fill WRITE failed (a transient error
            // that outlasted the retry budget, a validation veto, …). The
            // reference stays NULL — the very corruption pass 2 exists to
            // prevent — so this must be a reported, counted `error`, never a
            // warning. It is counted below (`recordDeferredError` → `allErrors`
            // → `success: false`), and until #4729 the LOG line contradicted
            // that count by sitting at `warn`: the one trace a seed leaves in
            // the console was the level nobody reads (#4420). Count and level
            // now agree, and the line owes the two things AGENTS.md
            // ("Degradation log levels") requires of an `error`: the
            // CONSEQUENCE and the FIX.
            this.logger.error(
              `[SeedLoader] Deferred reference back-fill FAILED — ${deferred.objectName}.${deferred.field} stays NULL ` +
                `on record '${deferred.recordExternalId}'. The row itself was seeded, so every row counter looks healthy ` +
                `while the circular relationship is HALF-WRITTEN: nothing links it to ${deferred.targetObject}.` +
                `${deferred.targetField} = '${this.formatAttempted(deferred.attemptedValue)}'. Nothing retries this — ` +
                `fix the write error below (a transient failure that outlasted the retry budget, or a validation rule ` +
                `vetoing the update) and re-run the seed to complete the link. ` +
                // [#8442] Same cause vocabulary as the pass-1 write sites: the
                // raw sentence always, MARKED when the payload half withheld it
                // so an operator can see the reporter did not receive this line.
                `${seedCauseLabel(err)}: ${seedFailureCause(err)}`,
              err instanceof Error ? err : undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
              },
            );
            // [#8442] The pass-2 counterpart of `buildWriteError`'s tail, and
            // the same rule: the located structure (which object, which field,
            // which target, which record) is authored here and untouched; only
            // the caught sentence is gated. The `logger.error` above is this
            // site's operator half — it runs on THIS path, in this same catch,
            // and carries the raw cause under {@link seedCauseLabel}, the same
            // marked vocabulary the pass-1 sites use. Both halves are pinned:
            // an assertion on the pass-2 logger lives beside the payload one in
            // `seed-loader-driver-text.test.ts`, so a later edit that withholds
            // here too cannot stay green.
            this.recordDeferredError(deferred, allResults, allErrors,
              `Failed to write deferred reference: ${deferred.objectName}.${deferred.field} = '${this.formatAttempted(deferred.attemptedValue)}' → ${deferred.targetObject}.${deferred.targetField}: ${quotableSeedFailureDetail(err) ?? WITHHELD_WRITE_REASON}`);
          }
        } else {
          // THE TARGET RESOLVED BUT THE SOURCE ROW HAS NO ID (#5127).
          //
          // Pass 2 did its job — `resolvedValue` is a real internal id — and
          // then found no internal id to write it ONTO: this load never
          // registered `deferred.recordExternalId` in `insertedRecords`. Until
          // now this branch did not exist, so the back-fill simply evaporated:
          // no write, no `errors`/`allErrors` entry (so `success` stayed true),
          // no `errored`, no log. The ONLY trace left was the `referencesDeferred`
          // this record booked in pass 1 and never gave back — a number with
          // nothing in the result explaining it.
          //
          // It is the deeper cousin of the two branches around it: #4729 fixed
          // "counted but logged at `warn`", #4997 fixed "counted, never logged",
          // this one was "never counted, never logged". Same objective criterion
          // as both (does the outcome enter `errors`/`allErrors`?) — so it is
          // recorded AND logged at `error` per AGENTS.md → "Degradation log
          // levels" (#4632): the row is in the database, every row counter reads
          // healthy, and the association it declares is permanently absent.
          //
          // `referencesDeferred` deliberately stays booked, exactly as the two
          // sibling failure branches leave it: the counter means "deferred
          // references that never landed", and only a SUCCESSFUL back-fill
          // decrements it. What was missing was never the arithmetic — it was
          // the error that explains the leftover, which `recordDeferredError`
          // now supplies (the load reports `success: false`, `errored` counts
          // the loss, and the dangling count has a matching entry in `errors`).
          //
          // The two ways to get here are NOT the same failure, so they do not
          // get the same line. An EMPTY `recordExternalId` is the pure silent
          // loss: `externalIdKey` returns `''` when any component of a composite
          // key is blank, the row itself wrote fine, and nothing anywhere else
          // reports it — this line is the only one a reader will ever see. A
          // NON-empty key that is simply absent from the map means the source
          // row did not land (or its write returned no id); that failure was
          // already reported at `error` by the pass-1 write site (#4729), so
          // this line points AT that error instead of restating it — one line,
          // not a second flood over the same root cause.
          const missedTarget = this.formatAttempted(deferred.attemptedValue);
          const where = `${deferred.targetObject}.${deferred.targetField} = '${missedTarget}'`;
          if (deferred.recordExternalId === '') {
            this.logger.error(
              `[SeedLoader] Deferred reference DROPPED — ${deferred.objectName}.${deferred.field} stays NULL ` +
                `FOREVER on record #${deferred.recordIndex}. Pass 2 RESOLVED the target (${where}) and then had ` +
                `nowhere to write it: that record's externalId (\`${deferred.externalIdLabel}\`) evaluated to the ` +
                `EMPTY key, which is what \`externalIdKey\` returns when the key field is absent or blank — or, ` +
                `for a composite key, when ANY one of its components is — so no internal id was ever registered ` +
                `for it in this load. The row itself WAS ` +
                `seeded, so every row counter looks healthy while the relationship is MISSING, and nothing ` +
                `retries this: pass 2 is the last one. Give every \`${deferred.externalIdLabel}\` component a ` +
                `non-empty value in the ${deferred.objectName} seed data (or declare an externalId whose parts ` +
                `are always present) and re-run the seed to complete the link.`,
              undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
                recordExternalId: deferred.recordExternalId,
              },
            );
            this.recordDeferredError(deferred, allResults, allErrors,
              `Deferred reference dropped: ${deferred.objectName}.${deferred.field} = '${missedTarget}' → ` +
                `${deferred.targetObject}.${deferred.targetField} resolved, but ${deferred.objectName} record ` +
                `#${deferred.recordIndex} has an empty \`${deferred.externalIdLabel}\` externalId, so no internal ` +
                `id was registered for it and the back-fill could not be written`);
          } else {
            this.logger.error(
              `[SeedLoader] Deferred reference DROPPED — ${deferred.objectName}.${deferred.field} is never written ` +
                `on record '${deferred.recordExternalId}'. Pass 2 RESOLVED the target (${where}) and then had ` +
                `nowhere to write it: this load registered no internal id for that ${deferred.objectName} record, ` +
                `because its pass-1 write FAILED (reported as its own \`error\` above) or returned no id. Nothing ` +
                `retries this: pass 2 back-fills only rows this load actually seeded, and it is the last pass. ` +
                `Fix the pass-1 write error reported for ${deferred.objectName} '${deferred.recordExternalId}' ` +
                `and re-run the seed — the row and this link land together or not at all.`,
              undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
                recordExternalId: deferred.recordExternalId,
              },
            );
            this.recordDeferredError(deferred, allResults, allErrors,
              `Deferred reference dropped: ${deferred.objectName}.${deferred.field} = '${missedTarget}' → ` +
                `${deferred.targetObject}.${deferred.targetField} resolved, but no internal id was registered for ` +
                `${deferred.objectName} '${deferred.recordExternalId}' in this load (its pass-1 write failed), so ` +
                `the back-fill could not be written`);
          }
        }
      } else {
        // Still unresolved after pass 2 — the target never materialized. Name
        // the element that missed: on a multi-value field only one of several
        // natural keys is usually at fault.
        //
        // Logged at `error` for the same reason the back-fill-write failure
        // above is, and aligned with it under the same objective criterion
        // (#4997, extending #4729/#5001): this outcome enters `allErrors` and
        // bumps `errored`, and until now it was the file's other
        // counted-but-never-logged branch. The row itself WAS seeded, so every
        // row counter reads healthy while the association it declared is
        // permanently absent.
        const missedValue = this.formatAttempted(stillUnresolved ? missingItem : deferred.attemptedValue);
        this.logger.error(
          `[SeedLoader] Deferred reference UNRESOLVED after pass 2 — ${deferred.objectName}.${deferred.field} ` +
            `stays NULL on record '${deferred.recordExternalId}'. The row itself was seeded, so every row ` +
            `counter looks healthy while the relationship is MISSING: nothing links it to ` +
            `${deferred.targetObject}.${deferred.targetField} = '${missedValue}', because no such ` +
            `${deferred.targetObject} row exists — neither seeded in this load nor already in the database. ` +
            `Nothing retries this: pass 2 is the last one. Add the missing ${deferred.targetObject} record to ` +
            `the seed (or fix the natural key that names it) and re-run the seed to complete the link.`,
          undefined,
          {
            object: deferred.objectName,
            field: deferred.field,
            target: `${deferred.targetObject}.${deferred.targetField}`,
            recordIndex: deferred.recordIndex,
          },
        );
        this.recordDeferredError(deferred, allResults, allErrors,
          `Deferred reference unresolved after pass 2: ${deferred.objectName}.${deferred.field} = '${missedValue}' → ${deferred.targetObject}.${deferred.targetField} not found`);
      }
    }
  }

  /**
   * Write ONE pass-2 back-fill — the update that turns a deferred reference
   * from NULL into the resolved id.
   *
   * Uses SEED_OPTIONS like every other seed write: this pass is still seeding,
   * so it must carry `skipTriggers` too. Inlining a bare `{ isSystem: true }`
   * here re-fired record-change automation on freshly seeded rows — `isSystem`
   * does NOT suppress trigger dispatch, only `skipTriggers` does — which is
   * exactly the self-trigger vector SEED_OPTIONS exists to prevent (#3760).
   *
   * Extracted (rather than inlined at the call site) so the durability gate can
   * SEE this seam: `scripts/check-durability-degradation-log-level.mjs` matches
   * a guarded `try` by the callee name it finds in the block, and it
   * deliberately does not descend into nested function bodies — the engine
   * write here lives inside the `withTransientRetry` closure, where no AST scan
   * of the try block can reach it. `writeDeferredReference` is listed in that
   * script's `DURABILITY_CRITICAL_CALLEES`, so a future edit that quietly drops
   * the caller's `logger.error` back to `warn` fails CI instead of shipping
   * (#4729; the rule is #4632, the accident it comes from is #4420).
   */
  private async writeDeferredReference(
    deferred: DeferredUpdate,
    recordId: string,
    resolvedValue: unknown,
  ): Promise<void> {
    await withTransientRetry(() => this.engine.update(deferred.objectName, {
      id: recordId,
      [deferred.field]: resolvedValue,
    }, SeedLoaderService.SEED_OPTIONS as any));
  }

  /**
   * Record a pass-2 (deferred) reference failure as a first-class error: it
   * lands in the object's per-result `errors`, bumps its `errored` count (so
   * `summary.totalErrored` is truthful), and joins `allErrors` (so the load
   * reports `success: false`). ALL THREE pass-2 failure modes route through here
   * so none can leave an incomplete relationship reported as a clean load
   * (framework#2805): the target is still missing, the back-fill write threw,
   * or — the mode that used to fall out of `resolveDeferredUpdates` without
   * reaching any of this (#5127) — the target resolved but the source record has
   * no registered internal id to write it onto.
   */
  private recordDeferredError(
    deferred: DeferredUpdate,
    allResults: SeedLoadResultParsed[],
    allErrors: ReferenceResolutionError[],
    message: string,
  ): void {
    const error: ReferenceResolutionError = {
      sourceObject: deferred.objectName,
      field: deferred.field,
      targetObject: deferred.targetObject,
      targetField: deferred.targetField,
      attemptedValue: deferred.attemptedValue,
      recordIndex: deferred.recordIndex,
      message,
    };
    const resultEntry = allResults.find(r => r.object === deferred.objectName);
    if (resultEntry) {
      resultEntry.errors.push(error);
      resultEntry.errored++;
    }
    allErrors.push(error);
  }

  // ==========================================================================
  // Internal: Write Operations
  // ==========================================================================

  /**
   * Seed writes always run as a privileged system context. This bypasses
   * RBAC checks (so seeds can target system tables like `sys_*`) and
   * disables the SecurityPlugin's auto-injection of `organization_id` /
   * `owner_id` — seeds either declare those fields explicitly per
   * record, or are intentionally cross-tenant / global.
   *
   * `skipTriggers` suppresses record-change AUTOMATION (autolaunched flow
   * triggers) for seed writes: a package's seed is pre-existing END-STATE
   * reference/sample data, not a stream of user events, so firing
   * on-create/on-update flows (notifications, escalations, assignments,
   * approvals) for it is semantically wrong and dangerous — a self-triggering
   * flow can loop and wedge the whole first-boot (2026-07-06 incident).
   * Lifecycle HOOKS (derived/default fields, validation) still run.
   *
   * `seedReplay` (#3433) tells the engine this is curated seed data so the
   * object's `state_machine` validation rule is skipped — both the
   * `initialStates` entry-point check on insert and the transition check on
   * update. A seed is a snapshot of established facts (a `completed` project, a
   * `closed_won` opportunity), not a record walking its lifecycle, so the FSM
   * entry/transition guards do not apply. Without this a declared
   * `initialStates` silently rejects every mid-lifecycle seed row and cascades
   * its master-detail children — the "installed but no data" failure for
   * showcase and every marketplace template. All OTHER validation (field
   * shape, `format`, `cross_field`, `script`, `json_schema`) still runs.
   */
  private static readonly SEED_OPTIONS = { context: { isSystem: true, skipTriggers: true, seedReplay: true } } as const;

  /**
   * The engine write {@link writeRecoveringSummary} guards, as a NAMED callee.
   *
   * Extracted for the same reason {@link writeDeferredReference} is:
   * `scripts/check-durability-degradation-log-level.mjs` recognises a guarded
   * `try` by the callee names it finds in the block and deliberately does not
   * descend into nested function bodies, so the `fn()` parameter this used to
   * call directly was invisible to it — no ledger entry could ever have
   * matched. `performSeedWrite` is listed in that script's
   * `DURABILITY_CRITICAL_CALLEES`, which is what makes the `logger.error`
   * below enforced rather than merely written down (#4998; the rule is #4632).
   */
  private async performSeedWrite<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  /**
   * Run an engine write; if it fails ONLY because a post-write roll-up summary
   * recompute exhausted its retries (framework#3147, `code`
   * 'ERR_SUMMARY_RECOMPUTE'), the record WAS written — return the written
   * value rather than re-writing (which would duplicate). Matched by `code` so
   * we needn't import objectql (which depends on this package — importing back
   * would cycle). Any other error propagates.
   *
   * The RECOVERY is unchanged; what it costs is now reported honestly (#4998).
   * A roll-up summary is a persisted DERIVED column on the parent record, so
   * exhausting its recompute retries leaves the database internally
   * inconsistent — detail rows say one thing, the column that summarizes them
   * says another — and nothing recomputes it until some later write touches
   * the same parent, which after a seed may never happen. That is the #4632
   * durability class exactly ("persisted state and runtime state disagree
   * while everything looks normal"), so it logs at `error` naming the
   * consequence and the remedy.
   *
   * It is also COUNTED, into `SeedLoadResultParsed.summariesStale` /
   * `summary.totalSummariesStale`, because a log line is not something a
   * caller can branch on. `success` deliberately stays `true`: the rows landed,
   * and every consumer of this result treats `success: false` as "the write
   * failed" — the protocol seed-apply surface returns it with an EMPTY errors
   * array, the runtime boot banner prints a "0 dropped record(s)" line, and the
   * package/marketplace installers fail an install that in fact wrote every
   * row. The new counter carries the signal instead.
   */
  private async writeRecoveringSummary<T>(objectName: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.performSeedWrite(fn);
    } catch (e: any) {
      if (e?.code === 'ERR_SUMMARY_RECOMPUTE') {
        this.reportStaleSummaries(objectName, e);
        return e.written as T;
      }
      throw e;
    }
  }

  /**
   * Count and announce the roll-up summaries a recovered write left stale.
   *
   * Split out of {@link writeRecoveringSummary}'s catch so the counting and the
   * `error` line are one unit: raising the level without counting was half the
   * #4998 defect, and counting without raising the level was the other half.
   */
  private reportStaleSummaries(objectName: string, e: SummaryRecomputeLike): void {
    const failures = Array.isArray(e.failures) ? e.failures : [];
    // One entry per parent record whose summary field could not be recomputed.
    // If the producer sent no usable list we still KNOW at least one summary is
    // stale — the error code says so — and counting 0 would restore exactly the
    // invisibility this counter exists to remove.
    const staleCount = failures.length || 1;
    const columns = [...new Set(
      failures
        .filter(f => f?.parentObject && f?.field)
        .map(f => `${f.parentObject}.${f.field}`),
    )];
    this.summariesStale += staleCount;
    this.logger.error(
      `[SeedLoader] roll-up summary recompute FAILED after retries while seeding ${objectName} — ` +
      `${staleCount} persisted summary value(s) on ` +
      `${columns.length > 0 ? columns.join(', ') : 'the parent record(s)'} now hold STALE values: ` +
      `they disagree with the detail rows they summarize, and nothing recomputes them on its own. ` +
      `The seeded rows themselves WERE written and are deliberately NOT re-written (that would ` +
      `duplicate them), so this load still reports success: true with every row counter clean — ` +
      `the machine-readable trace is summariesStale on this object's result ` +
      `(summary.totalSummariesStale for the load). Fix the recompute error below and re-run the ` +
      `seed, or trigger any write on the affected parent record(s) to force a recompute. ` +
      `Cause: ${e?.message ?? 'unknown'}`,
      e instanceof Error ? e : undefined,
      {
        object: objectName,
        summariesStale: staleCount,
        summaryColumns: columns,
        failures: failures.map(f => ({
          parentObject: f?.parentObject,
          parentId: f?.parentId,
          field: f?.field,
          error: f?.error instanceof Error ? f.error.message : f?.error,
        })),
      },
    );
  }

  private async writeRecord(
    objectName: string,
    record: Record<string, unknown>,
    mode: string,
    externalId: string | string[],
    existingRecords?: Map<string, any>,
  ): Promise<{ action: 'inserted' | 'updated' | 'skipped'; id?: string }> {
    const existing = existingRecords?.get(this.externalIdKey(record, externalId));
    const opts = SeedLoaderService.SEED_OPTIONS as any;

    switch (mode) {
      case 'insert': {
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      case 'update': {
        if (!existing) {
          return { action: 'skipped' };
        }
        const id = this.extractId(existing);
        if (this.isNoOpReplay(record, existing)) {
          return { action: 'skipped', id };
        }
        await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
        return { action: 'updated', id };
      }

      case 'upsert': {
        if (existing) {
          const id = this.extractId(existing);
          if (this.isNoOpReplay(record, existing)) {
            return { action: 'skipped', id };
          }
          await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
          return { action: 'updated', id };
        } else {
          const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
          return { action: 'inserted', id: this.extractId(result) };
        }
      }

      case 'ignore': {
        if (existing) {
          return { action: 'skipped', id: this.extractId(existing) };
        }
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      case 'replace': {
        // Replace mode: just insert (caller should have cleared the table)
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      default: {
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }
    }
  }

  /** Rows per batch for the buffered-insert flush. See framework#2678. */
  private static readonly BULK_BATCH_SIZE = 200;

  /**
   * Decide what {@link loadDataset}'s non-self-referencing (batched) path
   * should do with a record — mirrors {@link writeRecord}'s mode/existing
   * logic exactly, but WITHOUT performing the write, so insert decisions can
   * be buffered and flushed as a batch instead of one call per record.
   */
  private decideWriteAction(
    record: Record<string, unknown>,
    mode: string,
    externalId: string | string[],
    existingRecords?: Map<string, any>,
  ): { action: 'insert' } | { action: 'update'; id: string } | { action: 'skip'; id?: string } {
    const existing = existingRecords?.get(this.externalIdKey(record, externalId));

    switch (mode) {
      case 'update':
        if (!existing) return { action: 'skip' };
        return this.isNoOpReplay(record, existing)
          ? { action: 'skip', id: this.extractId(existing) }
          : { action: 'update', id: this.extractId(existing)! };
      case 'upsert':
        if (!existing) return { action: 'insert' };
        return this.isNoOpReplay(record, existing)
          ? { action: 'skip', id: this.extractId(existing) }
          : { action: 'update', id: this.extractId(existing)! };
      case 'ignore':
        return existing ? { action: 'skip', id: this.extractId(existing) } : { action: 'insert' };
      case 'insert':
      case 'replace':
      default:
        return { action: 'insert' };
    }
  }

  /**
   * A seed replay (dev-server restart, package re-publish) re-loads the same
   * records over existing rows. When nothing the seed declares actually
   * differs, rewriting the row is pure churn: `updated_at` gets bumped every
   * boot, lifecycle validation re-runs (a state_machine rule can even veto
   * the no-op), and history tracking logs a phantom edit. Skip those.
   *
   * Only fields PRESENT in the seed record are compared (the row's extra
   * columns — audit fields, values edited at runtime that the seed does not
   * pin — never block the skip). Comparison is conservative: any doubt
   * (unparseable dates, type mismatches) reads as "changed", falling back to
   * the historical update behavior.
   */
  private isNoOpReplay(record: Record<string, unknown>, existing: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id') continue;
      if (!this.seedValueEquals(value, existing[key])) return false;
    }
    return true;
  }

  /** Loose equality across driver round-trip representations (see isNoOpReplay). */
  private seedValueEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    // Booleans come back as 0/1 from SQLite.
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      const toNum = (v: unknown) => (typeof v === 'boolean' ? Number(v) : Number(String(v)));
      return toNum(a) === toNum(b);
    }
    // Dates come back as driver-formatted strings or epoch numbers.
    if (a instanceof Date || b instanceof Date) {
      const toTime = (v: unknown) =>
        v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v));
      const ta = toTime(a);
      const tb = toTime(b);
      return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
    }
    if (typeof a === 'object' || typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    // number 5 vs '5' after a driver round-trip.
    return String(a) === String(b);
  }

  /**
   * Builds the same `ReferenceResolutionError` shape a failed write has always
   * reported.
   *
   * [#8442] Every STRUCTURED key is unchanged — `sourceObject`, `field`,
   * `targetObject`, `targetField`, `attemptedValue`, `recordIndex` are built
   * from the seed declaration and the record, never from the caught error, so
   * "which record, which key" is untouched by the withhold. The authored prefix
   * is unchanged byte for byte too (two runtime pins read it). What changes is
   * only what follows the colon: a DECLARED refusal — a 4xx, or the data
   * engine's `VALIDATION_FAILED` shape, which is where "which field and why"
   * lives — is quoted whole; a driver fault is replaced by
   * {@link WITHHELD_WRITE_REASON} and goes to the log instead. See
   * {@link declaresSeedClientRefusal}.
   */
  private buildWriteError(
    objectName: string,
    record: Record<string, unknown>,
    externalId: string | string[],
    recordIndex: number,
    err: unknown,
  ): ReferenceResolutionError {
    const detail = quotableSeedFailureDetail(err) ?? WITHHELD_WRITE_REASON;
    const label = this.externalIdLabel(externalId);
    const keyValue = this.externalIdKey(record, externalId);
    return {
      sourceObject: objectName,
      field: '(write)',
      targetObject: objectName,
      targetField: label,
      attemptedValue: keyValue || null,
      recordIndex,
      message: `Failed to write ${objectName} record #${recordIndex} (${label}=${keyValue}): ${detail}`,
    };
  }

  // ==========================================================================
  // Internal: Dependency Graph
  // ==========================================================================

  /**
   * Kahn's algorithm for topological sort with cycle detection.
   */
  private topologicalSort(
    nodes: ObjectDependencyNodeParsed[],
  ): { insertOrder: string[]; circularDependencies: string[][] } {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const objectSet = new Set(nodes.map(n => n.object));

    // Initialize
    for (const node of nodes) {
      inDegree.set(node.object, 0);
      adjacency.set(node.object, []);
    }

    // Build adjacency list and in-degree counts
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        // Exclude self-references from ordering (e.g., employee.manager_id → employee).
        // Self-referencing fields are still tracked in node.references for resolution.
        if (objectSet.has(dep) && dep !== node.object) {
          adjacency.get(dep)!.push(node.object);
          inDegree.set(node.object, (inDegree.get(node.object) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [obj, degree] of inDegree) {
      if (degree === 0) queue.push(obj);
    }

    const insertOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      insertOrder.push(current);

      for (const neighbor of (adjacency.get(current) || [])) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Detect circular dependencies
    const circularDependencies: string[][] = [];
    const remaining = nodes.filter(n => !insertOrder.includes(n.object));

    if (remaining.length > 0) {
      // Find cycles using DFS
      const cycles = this.findCycles(remaining);
      circularDependencies.push(...cycles);

      // Add remaining objects to insertOrder (they'll need multi-pass)
      for (const node of remaining) {
        if (!insertOrder.includes(node.object)) {
          insertOrder.push(node.object);
        }
      }
    }

    return { insertOrder, circularDependencies };
  }

  private findCycles(nodes: ObjectDependencyNodeParsed[]): string[][] {
    const cycles: string[][] = [];
    const nodeMap = new Map(nodes.map(n => [n.object, n]));
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (current: string, path: string[]) => {
      if (inStack.has(current)) {
        // Found a cycle
        const cycleStart = path.indexOf(current);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), current]);
        }
        return;
      }
      if (visited.has(current)) return;

      visited.add(current);
      inStack.add(current);
      path.push(current);

      const node = nodeMap.get(current);
      if (node) {
        for (const dep of node.dependsOn) {
          if (nodeMap.has(dep)) {
            dfs(dep, [...path]);
          }
        }
      }

      inStack.delete(current);
    };

    for (const node of nodes) {
      if (!visited.has(node.object)) {
        dfs(node.object, []);
      }
    }

    return cycles;
  }

  // ==========================================================================
  // Internal: Helpers
  // ==========================================================================

  /**
   * Decide the environment this load filters on, and say so when it cannot.
   *
   * Precedence: an explicit `config.env` from the host always wins (it is the
   * documented escape hatch and the only way to seed "as" another
   * environment), then `NODE_ENV`.
   *
   * When neither answers, the load stays PERMISSIVE — every dataset is seeded,
   * exactly as before this fix — but says so loudly if, and only if, a dataset
   * actually narrowed its scope. Fail-open is the deliberate choice here:
   * fail-closed would also drop a `env: ['prod']` dataset on a production host
   * that merely forgot to export `NODE_ENV`, which is a silent data-loss
   * regression strictly worse than the over-seeding it prevents. The
   * indeterminate window is narrow by construction — both first-party boot
   * paths pin `NODE_ENV` — so this is the embedded-host case, and it is now
   * signposted rather than silent.
   */
  private resolveEnvConfig(config: SeedLoaderConfigParsed, seeds: Seed[]): SeedLoaderConfigParsed {
    if (config.env) return config;

    const resolved = resolveSeedEnvFromNodeEnv();
    if (resolved) return { ...config, env: resolved };

    const scoped = seeds.filter(isEnvScopedDataset);
    if (scoped.length > 0) {
      const named = scoped
        .map(d => `${d.object} (env: ${(d.env as string[]).join(', ')})`)
        .join('; ');
      this.logger.warn(
        `[SeedLoader] Cannot determine the runtime environment — NODE_ENV is unset or names no seed ` +
          `environment, so ${scoped.length} environment-scoped dataset(s) were seeded EVERYWHERE ` +
          `instead of only where they are declared: ${named}. Set NODE_ENV ` +
          `(production | development | test) on the host, or pass an explicit \`config.env\`, to make ` +
          `\`Seed.env\` take effect.`,
        { scoped: scoped.map(d => d.object) },
      );
    }
    return config;
  }

  /**
   * Drop datasets that do not apply to the resolved environment.
   *
   * Skipping is the declared, intended outcome (that is what `env: ['dev']`
   * asks for), so it logs at `info` rather than crying wolf on every
   * production boot — but it always NAMES what it dropped, so "my demo rows
   * are missing" is one log line to answer instead of a mystery.
   */
  private filterByEnv(datasets: Seed[], env?: SeedEnv): Seed[] {
    if (!env) return datasets;

    const kept: Seed[] = [];
    const skipped: Seed[] = [];
    for (const dataset of datasets) {
      (datasetAllowsEnv(dataset, env) ? kept : skipped).push(dataset);
    }

    if (skipped.length > 0) {
      this.logger.info(
        `[SeedLoader] Environment '${env}': skipped ${skipped.length} dataset(s) scoped to other ` +
          `environments: ${skipped.map(d => `${d.object} (env: ${(d.env as string[]).join(', ')})`).join('; ')}`,
        { env, skipped: skipped.map(d => d.object) },
      );
    }
    return kept;
  }

  private orderDatasets(datasets: Seed[], insertOrder: string[]): Seed[] {
    const orderMap = new Map(insertOrder.map((name, i) => [name, i]));
    return [...datasets].sort((a, b) => {
      const orderA = orderMap.get(a.object) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.object) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  }

  private buildReferenceMap(
    graph: ObjectDependencyGraphParsed,
    externalIdByObject?: Map<string, string | string[]>,
  ): Map<string, ReferenceResolutionParsed[]> {
    const map = new Map<string, ReferenceResolutionParsed[]>();
    for (const node of graph.nodes) {
      if (node.references.length > 0) {
        // Resolve against the TARGET dataset's declared externalId when this
        // load carries one (copy-on-write — graph.nodes is part of the public
        // result and keeps the metadata-level 'name' default). Targets with
        // no dataset in this load (e.g. a user field → os_user) keep 'name'.
        //
        // Only a SINGLE-field externalId participates in reference resolution:
        // a reference value is one natural-key string, so a composite-key
        // target (a join table keyed by several fields) can't be matched by
        // it — such targets keep the 'name' default (they're rarely, if ever,
        // referenced by another object anyway).
        const references = externalIdByObject
          ? node.references.map(ref => {
              const datasetExternalId = externalIdByObject.get(ref.targetObject);
              return typeof datasetExternalId === 'string' && datasetExternalId !== ref.targetField
                ? { ...ref, targetField: datasetExternalId }
                : ref;
            })
          : node.references;
        map.set(node.object, references);
      }
    }
    return map;
  }

  private async loadExistingRecords(
    objectName: string,
    externalId: string | string[],
    organizationId?: string,
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      // Full rows (not just id + externalId): the write decision compares the
      // incoming seed record against the existing row to skip no-op replays.
      const findArgs: Record<string, unknown> = {
        context: { isSystem: true },
      };
      // Per-tenant replay: restrict to the target tenant's own rows
      // so upsert key matching never returns another tenant's record
      // (would silently steal/overwrite rows across orgs).
      if (organizationId) findArgs.where = { organization_id: organizationId };
      const records = await this.engine.find(objectName, findArgs as any);
      for (const record of records || []) {
        const key = this.externalIdKey(record, externalId);
        if (key) {
          map.set(key, record);
        }
      }
    } catch (error) {
      // [#8896] Discriminate by error TYPE. This map is not a convenience —
      // it IS the decision, in all three of its callers, and an empty map is
      // the answer that means "write these rows":
      //
      //   1. the upsert/update/ignore pre-load above: an unmatched key is
      //      written as a new row, so a failed read turns every update into an
      //      INSERT — the duplicate-row outcome, against a table whose rows
      //      were simply not seen;
      //   2. `writeBatchPartial`'s `attempt > 1` recheck: `bulkWrite` is
      //      at-least-once, so a batch may have COMMITTED before its response
      //      was lost (framework#3149). The recheck is the only thing standing
      //      between that retry and a duplicate of every row it already wrote,
      //      and an empty map disarms it silently;
      //   3. `writeOne`'s per-row form of the same recheck, on the degradation
      //      path.
      //
      // The bare `catch {}` this replaces reached all three with "there are no
      // existing rows" no matter WHY the read failed — a connection drop, a
      // timeout, a permission denial, a query error — which is ADR-0110 D3's
      // exact shape: "the read found nothing" and "the read could not run" are
      // different facts, and here they have opposite consequences.
      //
      // Benign, unchanged: the object's TABLE has not been provisioned yet
      // (schema sync has not run — the seed's own write provisions it). It can
      // hold no rows, so an empty map IS the truth and every caller's "write
      // it" verdict is correct. Note the swallowed comment named a case that
      // cannot reach here at all: an object that merely "may not have records
      // yet" answers `find` with `[]`, it does not throw.
      //
      // Everything else propagates: the loader stops rather than computing a
      // write plan from data it never read. No new error code and no new
      // result field — the caller receives the read's own failure, envelope
      // intact, and the seed's existing error accounting reports it.
      if (!isMissingTableError(error)) throw error;
    }
    return map;
  }

  private looksLikeInternalId(value: string): boolean {
    // UUID v4 pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return true;
    }
    // MongoDB ObjectId pattern (24 hex chars)
    if (/^[0-9a-f]{24}$/i.test(value)) {
      return true;
    }
    return false;
  }

  private extractId(record: any): string | undefined {
    if (!record) return undefined;
    return String(record.id || record._id || '');
  }

  /**
   * Build the natural-key string for a record given the dataset's externalId.
   *
   * A single field name keys on that one column (the historical behavior). A
   * COMPOSITE externalId — a list of field names, for objects with no single
   * natural key such as a join / junction table (`['team', 'project']`) —
   * joins the per-field values with a separator (`\u0000`) that cannot occur
   * in a natural-key value, so `('a', 'b')` and `('a\0b', '')` never collide.
   *
   * Composite key fields are usually the join table's foreign keys; by the
   * time this runs they have been RESOLVED to the parent's internal id on the
   * incoming record, and existing DB rows already store that same id, so the
   * two keys match on replay and the row dedupes (framework#3434).
   *
   * Returns '' when ANY component is absent — a partial key is not a usable
   * uniqueness key, so callers fall back to inserting (this mirrors the
   * single-field miss, which also yields '').
   */
  private externalIdKey(record: Record<string, unknown>, externalId: string | string[]): string {
    if (Array.isArray(externalId)) {
      const parts: string[] = [];
      for (const field of externalId) {
        const value = record[field];
        if (value === undefined || value === null || value === '') return '';
        parts.push(String(value));
      }
      return parts.join('\u0000');
    }
    return String(record[externalId] ?? '');
  }

  /** Readable rendering of an attempted reference value (`['a','b']` for a multi-value field). */
  private formatAttempted(value: unknown): string {
    return Array.isArray(value) ? JSON.stringify(value) : String(value);
  }

  /** Human-readable label for an externalId (single field, or `a+b` for a composite). */
  private externalIdLabel(externalId: string | string[]): string {
    return Array.isArray(externalId) ? externalId.join('+') : externalId;
  }

  private buildEmptyResult(config: SeedLoaderConfigParsed, durationMs: number): SeedLoaderResultParsed {
    return {
      success: true,
      dryRun: config.dryRun,
      dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
      results: [],
      errors: [],
      summary: {
        objectsProcessed: 0,
        totalRecords: 0,
        totalInserted: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 0,
        totalReferencesDeferred: 0,
        totalReferencesDropped: 0,
        totalSummariesStale: 0,
        circularDependencyCount: 0,
        durationMs,
      },
    };
  }

  private buildResult(
    config: SeedLoaderConfigParsed,
    graph: ObjectDependencyGraphParsed,
    results: SeedLoadResultParsed[],
    errors: ReferenceResolutionError[],
    durationMs: number,
  ): SeedLoaderResultParsed {
    const summary = {
      objectsProcessed: results.length,
      totalRecords: results.reduce((sum, r) => sum + r.total, 0),
      totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
      totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
      totalErrored: results.reduce((sum, r) => sum + r.errored, 0),
      totalReferencesResolved: results.reduce((sum, r) => sum + r.referencesResolved, 0),
      totalReferencesDeferred: results.reduce((sum, r) => sum + r.referencesDeferred, 0),
      totalReferencesDropped: results.reduce((sum, r) => sum + (r.referencesDropped ?? 0), 0),
      // No `?? 0`: every result entry is built by `loadDataset`, which always
      // populates `summariesStale`. A consumer never needs the fallback either
      // — the field is declared with `.default(0)`, so it survives a parse of a
      // payload written before it existed (#4998).
      totalSummariesStale: results.reduce((sum, r) => sum + r.summariesStale, 0),
      circularDependencyCount: graph.circularDependencies.length,
      durationMs,
    };

    const hasErrors = errors.length > 0 || summary.totalErrored > 0;

    return {
      success: !hasErrors,
      dryRun: config.dryRun,
      dependencyGraph: graph,
      results,
      errors,
      summary,
    };
  }
}

// ==========================================================================
// Internal Types
// ==========================================================================

/**
 * Structural view of objectql's `SummaryRecomputeError` (framework#3147).
 *
 * Declared here rather than imported because objectql depends on THIS package,
 * so importing it back would cycle — the same reason the error is matched by
 * `code` instead of `instanceof`. Every field is optional: this describes an
 * object that crossed a package boundary as `unknown`, and the reader
 * ({@link SeedLoaderService.reportStaleSummaries}) is what decides what to do
 * when a field is missing.
 */
interface SummaryRecomputeLike {
  message?: string;
  failures?: Array<{
    childObject?: string;
    parentObject?: string;
    parentId?: string;
    field?: string;
    error?: unknown;
  }>;
}

interface DeferredUpdate {
  objectName: string;
  /**
   * The source record's natural key, as {@link SeedLoaderService.externalIdKey}
   * computed it in pass 1 — the key pass 2 looks the record's internal id up by.
   *
   * May legitimately be `''`: `externalIdKey` returns the empty string when the
   * key field is absent or blank, and — the case that actually bites — when ANY
   * ONE component of a composite externalId is. An empty key is
   * never registered in `insertedRecords`, so a deferred update carrying one can
   * never find its record in pass 2 — which is precisely the "wrote the row,
   * dropped the link" case #5127 exists to report. Carried verbatim (not
   * normalised to `undefined`) so pass 2 can tell that case apart from a real
   * key whose record simply failed to write.
   */
  recordExternalId: string;
  /**
   * Human-readable name of the source dataset's externalId (`name`, or `a+b` for
   * a composite) — pass 2 has no other handle on it, and an empty
   * `recordExternalId` is only actionable if the message can say WHICH key came
   * out empty (#5127).
   */
  externalIdLabel: string;
  field: string;
  targetObject: string;
  targetField: string;
  /** Authored value — one natural key, or the WHOLE array for a `multiple: true` field. */
  attemptedValue: unknown;
  /** Source field stores an array of references, so pass 2 back-fills an array. */
  multiple?: boolean;
  recordIndex: number;
}
