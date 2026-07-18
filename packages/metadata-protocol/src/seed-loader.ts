// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IMetadataService, ISeedLoaderService } from '@objectstack/spec/contracts';
import type {
  SeedLoaderRequest,
  SeedLoaderResult,
  SeedLoaderConfig,
  SeedLoaderConfigInput,
  ObjectDependencyGraph,
  ObjectDependencyNode,
  ReferenceResolution,
  ReferenceResolutionError,
  SeedLoadResult,
  Seed,
} from '@objectstack/spec/data';
import { SeedLoaderConfigSchema } from '@objectstack/spec/data';
import { resolveSeedRecord } from '@objectstack/formula';
import { bulkWrite, withTransientRetry, defaultIsTransientError, type BulkWriteRowResult } from '@objectstack/core';

interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, error?: Error, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

/** Default field used for externalId matching on target objects */
const DEFAULT_EXTERNAL_ID_FIELD = 'name';

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

  constructor(engine: IDataEngine, metadata: IMetadataService, logger: Logger) {
    this.engine = engine;
    this.metadata = metadata;
    this.logger = logger;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  async load(request: SeedLoaderRequest): Promise<SeedLoaderResult> {
    const startTime = Date.now();
    const config = request.config;
    const allErrors: ReferenceResolutionError[] = [];
    const allResults: SeedLoadResult[] = [];

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
    const externalIdByObject = new Map<string, string>(
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

  async buildDependencyGraph(objectNames: string[]): Promise<ObjectDependencyGraph> {
    const nodes: ObjectDependencyNode[] = [];
    const objectSet = new Set(objectNames);

    for (const objectName of objectNames) {
      const objDef = await this.metadata.getObject(objectName) as any;
      const dependsOn: string[] = [];
      const references: ReferenceResolution[] = [];

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

  async validate(datasets: Seed[], config?: SeedLoaderConfigInput): Promise<SeedLoaderResult> {
    const parsedConfig = SeedLoaderConfigSchema.parse({ ...config, dryRun: true });
    return this.load({ seeds: datasets, config: parsedConfig });
  }

  // ==========================================================================
  // Internal: Seed Loading
  // ==========================================================================

  private async loadDataset(
    dataset: Seed,
    config: SeedLoaderConfig,
    refMap: Map<string, ReferenceResolution[]>,
    insertedRecords: Map<string, Map<string, string>>,
    deferredUpdates: DeferredUpdate[],
    allErrors: ReferenceResolutionError[],
  ): Promise<SeedLoadResult> {
    const objectName = dataset.object;
    const mode = dataset.mode || config.defaultMode;
    const externalId = dataset.externalId || 'name';

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;
    let referencesResolved = 0;
    let referencesDeferred = 0;
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
    const extIdOf = (rec: Record<string, unknown>) => String(rec[externalId] ?? '');
    // bulkWrite is at-least-once: a retry (or a mismatch-driven degradation)
    // may re-run a write whose prior attempt already committed. Guard against
    // duplicate seed rows by rechecking natural keys before re-inserting
    // (framework#3149). `lastBatchUncertain` carries the "prior batch outcome
    // unknown" signal into the per-row degradation writeOne calls.
    let lastBatchUncertain = false;
    const isUncertainOutcome = (e: unknown) =>
      defaultIsTransientError(e) || (e as { code?: unknown } | null)?.code === 'ERR_BULK_RESULT_MISMATCH';
    // Reassemble one record per input row in order: rows already present are
    // represented by the existing record; the rest are consumed in order from
    // the freshly-inserted list.
    const assembleInOrder = (rows: Record<string, unknown>[], existing: Map<string, any>, freshlyInserted: any[]): any[] => {
      let k = 0;
      return rows.map((r) => {
        const key = extIdOf(r);
        if (key && existing.has(key)) return existing.get(key);
        return freshlyInserted[k++];
      });
    };
    const flushPendingInserts = async (): Promise<void> => {
      if (pendingInserts.length === 0) return;
      const batch = pendingInserts.splice(0, pendingInserts.length);
      const writeResults: BulkWriteRowResult[] = await bulkWrite(
        batch.map(b => b.record),
        {
          batchSize: SeedLoaderService.BULK_BATCH_SIZE,
          writeBatch: async (rows, { attempt }) => {
            let toInsert = rows;
            let existing = new Map<string, any>();
            if (attempt > 1) {
              // Prior attempt may have committed before its response was lost:
              // insert only rows not already present so a retry can't duplicate.
              existing = await this.loadExistingRecords(objectName, externalId, config.organizationId);
              toInsert = rows.filter((r) => { const k = extIdOf(r); return !(k && existing.has(k)); });
            }
            try {
              // A lone row keeps the historical bare-record insert() call shape
              // (no array wrapping) so single-record datasets are byte-for-byte
              // unchanged; only a real batch (>1) uses the array/bulk form.
              const freshlyInserted = toInsert.length === 0
                ? []
                : toInsert.length === 1
                  ? [await this.writeRecoveringSummary(() => this.engine.insert(objectName, toInsert[0], opts))]
                  : await this.writeRecoveringSummary(() => this.engine.insert(objectName, toInsert, opts));
              lastBatchUncertain = false;
              return assembleInOrder(rows, existing, freshlyInserted as any[]);
            } catch (e) {
              lastBatchUncertain = isUncertainOutcome(e);
              throw e;
            }
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
            return this.writeRecoveringSummary(() => this.engine.insert(objectName, row, opts));
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
          this.logger.warn(`[SeedLoader] ${error.message}`, { recordIndex });
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
        this.logger.warn(`[SeedLoader] ${error.message}`);
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
      if (tenantOrg && record['organization_id'] == null) {
        record['organization_id'] = tenantOrg;
      }

      // Resolve references
      let unresolvedRefError = false;
      for (const ref of objectRefs) {
        const fieldValue = record[ref.field];
        if (fieldValue === undefined || fieldValue === null) continue;

        // LOUD FAILURE: a reference must be a natural-key string (or an
        // internal id). An object value — e.g. the wrapper `{ externalId: 'X' }`
        // — never resolves: it would otherwise fall through unresolved and reach
        // the driver as a non-bindable value ("SQLite3 can only bind ..."). This
        // used to be silently skipped (and only crashed on a persistent DB's
        // update path), so catch it here and report the actionable fix instead.
        if (typeof fieldValue === 'object') {
          const wrapped = (fieldValue as Record<string, unknown>).externalId;
          const hint =
            wrapped !== undefined
              ? ` Pass the natural key directly: ${ref.field}: ${JSON.stringify(wrapped)}.`
              : ` Pass the target's ${ref.targetField} value as a plain string.`;
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: ref.field,
            targetObject: ref.targetObject,
            targetField: ref.targetField,
            attemptedValue: fieldValue,
            recordIndex: i,
            message:
              `Invalid reference for ${objectName}.${ref.field}: expected a ` +
              `${ref.targetObject}.${ref.targetField} natural-key string but got an object.${hint}`,
          };
          errors.push(error);
          allErrors.push(error);
          this.logger.warn(`[SeedLoader] ${error.message}`, { recordIndex: i });
          // Drop the unresolvable value so it never reaches the driver.
          // Removing the key (not writing null) matters on the upsert UPDATE
          // path: an explicit null would overwrite the existing row's valid
          // reference, silently severing the link on every seed replay.
          delete record[ref.field];
          continue;
        }

        // Skip if value looks like an internal ID (not a natural key)
        if (typeof fieldValue !== 'string' || this.looksLikeInternalId(fieldValue)) continue;

        // Try to resolve via already-inserted records
        const targetMap = insertedRecords.get(ref.targetObject);
        const resolvedId = targetMap?.get(String(fieldValue));

        if (resolvedId) {
          record[ref.field] = resolvedId;
          referencesResolved++;
        } else if (!config.dryRun) {
          // Try to resolve from existing data in the database
          const dbId = await this.resolveFromDatabase(ref.targetObject, ref.targetField, fieldValue, config.organizationId);
          if (dbId) {
            record[ref.field] = dbId;
            referencesResolved++;
          } else if (config.multiPass) {
            // Defer to pass 2. REMOVE the field rather than writing null:
            // on insert a missing column lands NULL anyway (placeholder until
            // pass 2 back-fills it), but on the upsert UPDATE path an explicit
            // null would OVERWRITE the existing row's already-correct
            // reference — every dev-server restart severed one link per
            // replayed record (NOT NULL columns turned this into a loud
            // constraint error; nullable ones silently lost the association).
            delete record[ref.field];
            deferredUpdates.push({
              objectName,
              recordExternalId: String(record[externalId] ?? ''),
              field: ref.field,
              targetObject: ref.targetObject,
              targetField: ref.targetField,
              attemptedValue: fieldValue,
              recordIndex: i,
            });
            referencesDeferred++;
          } else {
            // Cannot resolve and no pass 2 will run — skip the whole record
            // (LOUD: counted + reported). Writing it anyway would either
            // carry the raw natural-key string into the FK column or, on
            // update, corrupt the existing row.
            const error: ReferenceResolutionError = {
              sourceObject: objectName,
              field: ref.field,
              targetObject: ref.targetObject,
              targetField: ref.targetField,
              attemptedValue: fieldValue,
              recordIndex: i,
              message: `Cannot resolve reference: ${objectName}.${ref.field} = '${fieldValue}' → ${ref.targetObject}.${ref.targetField} not found`,
            };
            errors.push(error);
            allErrors.push(error);
            unresolvedRefError = true;
          }
        } else {
          // Dry-run: attempt resolution, report error if not found
          const targetMap2 = insertedRecords.get(ref.targetObject);
          if (!targetMap2?.has(String(fieldValue))) {
            const error: ReferenceResolutionError = {
              sourceObject: objectName,
              field: ref.field,
              targetObject: ref.targetObject,
              targetField: ref.targetField,
              attemptedValue: fieldValue,
              recordIndex: i,
              message: `[dry-run] Reference may not resolve: ${objectName}.${ref.field} = '${fieldValue}' → ${ref.targetObject}.${ref.targetField}`,
            };
            errors.push(error);
            allErrors.push(error);
          }
        }
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

            const externalIdValue = String(record[externalId] ?? '');
            const internalId = result.id;
            if (externalIdValue && internalId) {
              insertedRecords.get(objectName)!.set(externalIdValue, String(internalId));
            }
          } catch (err: any) {
            errored++;
            // Same cascade guard as the batched update path: the row may
            // already exist (rejected update), so keep its natural-key
            // mapping alive for downstream reference resolution.
            const existingId = this.extractId(existingRecords?.get(String(record[externalId] ?? '')));
            const externalIdValue = String(record[externalId] ?? '');
            if (externalIdValue && existingId) {
              insertedRecords.get(objectName)!.set(externalIdValue, existingId);
            }
            const error = this.buildWriteError(objectName, record, externalId, i, err);
            errors.push(error);
            allErrors.push(error);
            this.logger.warn(`[SeedLoader] ${error.message}`, { recordIndex: i });
          }
        } else {
          const decision = this.decideWriteAction(record, mode, externalId, existingRecords);
          const externalIdValue = String(record[externalId] ?? '');

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
              await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.update(objectName, { ...record, id: decision.id }, opts)));
              updated++;
            } catch (err: any) {
              errored++;
              const error = this.buildWriteError(objectName, record, externalId, i, err);
              errors.push(error);
              allErrors.push(error);
              this.logger.warn(`[SeedLoader] ${error.message}`, { recordIndex: i });
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
        const externalIdValue = String(record[externalId] ?? '');
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
    allResults: SeedLoadResult[],
    allErrors: ReferenceResolutionError[],
    organizationId?: string,
  ): Promise<void> {
    for (const deferred of deferredUpdates) {
      // Try to resolve from inserted records
      const targetMap = insertedRecords.get(deferred.targetObject);
      let resolvedId = targetMap?.get(String(deferred.attemptedValue));

      // Try database fallback
      if (!resolvedId) {
        resolvedId = (await this.resolveFromDatabase(
          deferred.targetObject, deferred.targetField, deferred.attemptedValue, organizationId
        )) ?? undefined;
      }

      if (resolvedId) {
        // Find the record and update the reference
        const objectRecordMap = insertedRecords.get(deferred.objectName);
        const recordId = objectRecordMap?.get(deferred.recordExternalId);

        if (recordId) {
          try {
            await withTransientRetry(() => this.engine.update(deferred.objectName, {
              id: recordId,
              [deferred.field]: resolvedId,
            }, { context: { isSystem: true } } as any));

            // Update result stats
            const resultEntry = allResults.find(r => r.object === deferred.objectName);
            if (resultEntry) {
              resultEntry.referencesResolved++;
              resultEntry.referencesDeferred--;
            }
          } catch (err: any) {
            this.logger.warn('[SeedLoader] Failed to resolve deferred reference', {
              object: deferred.objectName,
              field: deferred.field,
              error: err.message,
            });
          }
        }
      } else {
        // Still unresolved after pass 2
        const error: ReferenceResolutionError = {
          sourceObject: deferred.objectName,
          field: deferred.field,
          targetObject: deferred.targetObject,
          targetField: deferred.targetField,
          attemptedValue: deferred.attemptedValue,
          recordIndex: deferred.recordIndex,
          message: `Deferred reference unresolved after pass 2: ${deferred.objectName}.${deferred.field} = '${deferred.attemptedValue}' → ${deferred.targetObject}.${deferred.targetField} not found`,
        };

        const resultEntry = allResults.find(r => r.object === deferred.objectName);
        if (resultEntry) {
          resultEntry.errors.push(error);
        }
        allErrors.push(error);
      }
    }
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
   */
  private static readonly SEED_OPTIONS = { context: { isSystem: true, skipTriggers: true } } as const;

  /**
   * Run an engine write; if it fails ONLY because a post-write roll-up summary
   * recompute exhausted its retries (framework#3147, `code`
   * 'ERR_SUMMARY_RECOMPUTE'), the record WAS written — treat it as a warning
   * and return the written value rather than re-writing (which would
   * duplicate). Matched by `code` so we needn't import objectql (which depends
   * on this package — importing back would cycle). Any other error propagates.
   */
  private async writeRecoveringSummary<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.code === 'ERR_SUMMARY_RECOMPUTE') {
        this.logger.warn(
          '[SeedLoader] roll-up summary recompute failed after retries; records were written (summary values may be stale)',
          { failures: Array.isArray(e.failures) ? e.failures.length : undefined },
        );
        return e.written as T;
      }
      throw e;
    }
  }

  private async writeRecord(
    objectName: string,
    record: Record<string, unknown>,
    mode: string,
    externalId: string,
    existingRecords?: Map<string, any>,
  ): Promise<{ action: 'inserted' | 'updated' | 'skipped'; id?: string }> {
    const externalIdValue = record[externalId];
    const existing = existingRecords?.get(String(externalIdValue ?? ''));
    const opts = SeedLoaderService.SEED_OPTIONS as any;

    switch (mode) {
      case 'insert': {
        const result = await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
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
        await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
        return { action: 'updated', id };
      }

      case 'upsert': {
        if (existing) {
          const id = this.extractId(existing);
          if (this.isNoOpReplay(record, existing)) {
            return { action: 'skipped', id };
          }
          await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
          return { action: 'updated', id };
        } else {
          const result = await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
          return { action: 'inserted', id: this.extractId(result) };
        }
      }

      case 'ignore': {
        if (existing) {
          return { action: 'skipped', id: this.extractId(existing) };
        }
        const result = await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      case 'replace': {
        // Replace mode: just insert (caller should have cleared the table)
        const result = await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      default: {
        const result = await this.writeRecoveringSummary(() => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
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
    externalId: string,
    existingRecords?: Map<string, any>,
  ): { action: 'insert' } | { action: 'update'; id: string } | { action: 'skip'; id?: string } {
    const externalIdValue = record[externalId];
    const existing = existingRecords?.get(String(externalIdValue ?? ''));

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

  /** Builds the same `ReferenceResolutionError` shape a failed write has always reported. */
  private buildWriteError(
    objectName: string,
    record: Record<string, unknown>,
    externalId: string,
    recordIndex: number,
    err: unknown,
  ): ReferenceResolutionError {
    const message = (err as { message?: unknown } | null)?.message ?? String(err);
    return {
      sourceObject: objectName,
      field: '(write)',
      targetObject: objectName,
      targetField: externalId,
      attemptedValue: record[externalId] ?? null,
      recordIndex,
      message: `Failed to write ${objectName} record #${recordIndex} (${externalId}=${String(record[externalId] ?? '')}): ${message}`,
    };
  }

  // ==========================================================================
  // Internal: Dependency Graph
  // ==========================================================================

  /**
   * Kahn's algorithm for topological sort with cycle detection.
   */
  private topologicalSort(
    nodes: ObjectDependencyNode[],
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

  private findCycles(nodes: ObjectDependencyNode[]): string[][] {
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

  private filterByEnv(datasets: Seed[], env?: string): Seed[] {
    if (!env) return datasets;
    return datasets.filter(d => (d.env as string[]).includes(env));
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
    graph: ObjectDependencyGraph,
    externalIdByObject?: Map<string, string>,
  ): Map<string, ReferenceResolution[]> {
    const map = new Map<string, ReferenceResolution[]>();
    for (const node of graph.nodes) {
      if (node.references.length > 0) {
        // Resolve against the TARGET dataset's declared externalId when this
        // load carries one (copy-on-write — graph.nodes is part of the public
        // result and keeps the metadata-level 'name' default). Targets with
        // no dataset in this load (e.g. a user field → os_user) keep 'name'.
        const references = externalIdByObject
          ? node.references.map(ref => {
              const datasetExternalId = externalIdByObject.get(ref.targetObject);
              return datasetExternalId && datasetExternalId !== ref.targetField
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
    externalId: string,
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
        const key = String(record[externalId] ?? '');
        if (key) {
          map.set(key, record);
        }
      }
    } catch {
      // Object may not have records yet
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

  private buildEmptyResult(config: SeedLoaderConfig, durationMs: number): SeedLoaderResult {
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
        circularDependencyCount: 0,
        durationMs,
      },
    };
  }

  private buildResult(
    config: SeedLoaderConfig,
    graph: ObjectDependencyGraph,
    results: SeedLoadResult[],
    errors: ReferenceResolutionError[],
    durationMs: number,
  ): SeedLoaderResult {
    const summary = {
      objectsProcessed: results.length,
      totalRecords: results.reduce((sum, r) => sum + r.total, 0),
      totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
      totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
      totalErrored: results.reduce((sum, r) => sum + r.errored, 0),
      totalReferencesResolved: results.reduce((sum, r) => sum + r.referencesResolved, 0),
      totalReferencesDeferred: results.reduce((sum, r) => sum + r.referencesDeferred, 0),
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

interface DeferredUpdate {
  objectName: string;
  recordExternalId: string;
  field: string;
  targetObject: string;
  targetField: string;
  attemptedValue: unknown;
  recordIndex: number;
}
