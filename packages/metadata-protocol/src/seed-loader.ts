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
 * - Topological dependency ordering (parents before children)
 * - Multi-pass loading for circular references
 * - Dry-run validation mode
 * - Upsert support honoring SeedSchema mode
 * - Actionable error reporting
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

    // 4. Build reference lookup map from metadata (field → target object)
    const refMap = this.buildReferenceMap(graph);

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
          record[ref.field] = null;
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
            // Defer to pass 2
            record[ref.field] = null;
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
            // Cannot resolve - record error
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

      // Insert/upsert the record
      if (!config.dryRun) {
        try {
          const result = await this.writeRecord(
            objectName, record, mode, externalId, existingRecords
          );

          if (result.action === 'inserted') inserted++;
          else if (result.action === 'updated') updated++;
          else if (result.action === 'skipped') skipped++;

          // Track the inserted/updated record's ID for reference resolution
          const externalIdValue = String(record[externalId] ?? '');
          const internalId = result.id;
          if (externalIdValue && internalId) {
            insertedRecords.get(objectName)!.set(externalIdValue, String(internalId));
          }
        } catch (err: any) {
          // LOUD FAILURE: write errors were previously only counted +
          // warn-logged, so dropped rows were invisible in result.errors and
          // the boot summary. Surface them as actionable errors too, so the
          // overall load is marked unsuccessful and the reason is reported.
          errored++;
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: '(write)',
            targetObject: objectName,
            targetField: externalId,
            attemptedValue: record[externalId] ?? null,
            recordIndex: i,
            message: `Failed to write ${objectName} record #${i} (${externalId}=${String(record[externalId] ?? '')}): ${err.message}`,
          };
          errors.push(error);
          allErrors.push(error);
          this.logger.warn(`[SeedLoader] ${error.message}`, { recordIndex: i });
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
    try {
      const where: Record<string, unknown> = { [targetField]: value };
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
      if (records && records.length > 0) {
        return String(records[0].id || records[0]._id);
      }
      // Fallback: the value may already be the target's internal id rather than
      // its natural key — a seed that wires a lookup to a real existing record
      // (e.g. a people field → the current user, whose id is not a UUID/ObjectId
      // so `looksLikeInternalId` did not short-circuit). Resolving by id lets a
      // valid id resolve instead of dangling null, with no risk of a false
      // natural-key match (an id either exists or it does not).
      if (targetField !== 'id') {
        const byId: Record<string, unknown> = { id: value };
        if (organizationId) byId.organization_id = organizationId;
        const idMatch = await this.engine.find(targetObject, {
          where: byId,
          fields: ['id'],
          limit: 1,
          context: { isSystem: true },
        } as any);
        if (idMatch && idMatch.length > 0) {
          return String(idMatch[0].id || idMatch[0]._id);
        }
      }
    } catch {
      // Target object may not exist yet
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
            await this.engine.update(deferred.objectName, {
              id: recordId,
              [deferred.field]: resolvedId,
            }, { context: { isSystem: true } } as any);

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
   */
  private static readonly SEED_OPTIONS = { context: { isSystem: true } } as const;

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
        const result = await this.engine.insert(objectName, record, opts);
        return { action: 'inserted', id: this.extractId(result) };
      }

      case 'update': {
        if (!existing) {
          return { action: 'skipped' };
        }
        const id = this.extractId(existing);
        await this.engine.update(objectName, { ...record, id }, opts);
        return { action: 'updated', id };
      }

      case 'upsert': {
        if (existing) {
          const id = this.extractId(existing);
          await this.engine.update(objectName, { ...record, id }, opts);
          return { action: 'updated', id };
        } else {
          const result = await this.engine.insert(objectName, record, opts);
          return { action: 'inserted', id: this.extractId(result) };
        }
      }

      case 'ignore': {
        if (existing) {
          return { action: 'skipped', id: this.extractId(existing) };
        }
        const result = await this.engine.insert(objectName, record, opts);
        return { action: 'inserted', id: this.extractId(result) };
      }

      case 'replace': {
        // Replace mode: just insert (caller should have cleared the table)
        const result = await this.engine.insert(objectName, record, opts);
        return { action: 'inserted', id: this.extractId(result) };
      }

      default: {
        const result = await this.engine.insert(objectName, record, opts);
        return { action: 'inserted', id: this.extractId(result) };
      }
    }
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

  private buildReferenceMap(graph: ObjectDependencyGraph): Map<string, ReferenceResolution[]> {
    const map = new Map<string, ReferenceResolution[]>();
    for (const node of graph.nodes) {
      if (node.references.length > 0) {
        map.set(node.object, node.references);
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
      const findArgs: Record<string, unknown> = {
        fields: ['id', externalId],
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
