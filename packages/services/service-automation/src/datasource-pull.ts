// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D1, D2, D8] The pull of a `mapping`'s `datasourceSource`: a
 * federated object (ADR-0015) read in windows cut on `watermark.field`
 * (`./datasource-window-read.ts`) and written into the mapping's `synced`
 * target through the import runner, as a connector pull writes.
 *
 * `pullConnectorSource` (`./connector-pull.ts`) reads the mapping and hands a
 * mapping that carries `datasourceSource` here, so both sources answer the
 * same contract method, `IAutomationService.pullConnectorSource`, and the
 * result's `source` says which one ran.
 *
 * ## What is judged before the first read
 *
 * The build judges a sourced mapping against the stack's objects
 * (`collectSourcedMappingErrors`), but a stack with no objects, a stored
 * mapping and a federated object registered at run time all reach the pull
 * unjudged. So every rule the read rests on is judged again here, from the
 * objects as the protocol serves them, with the build's own tokens where the
 * ADR names one:
 *
 * - the target is `managedBy: 'synced'` (D4) — `mapping_target_refused`;
 * - the source is a federated object on a non-managed datasource (D1) —
 *   `source_binding_invalid`;
 * - its `external.columnMap` maps a column onto `id` (invariant 6) —
 *   `source_key_missing`;
 * - `watermark.field` is a `datetime`, `date` or `scale: 0` number field of
 *   the source (invariant 1) — `source_binding_invalid`;
 * - a `fieldMapping` entry copies it unchanged onto a target field of its type
 *   (D3) — `watermark_field_unmapped`;
 * - [D8] under a walled tenancy posture the source states its organization
 *   scope: its own `organization_id` (every read then carries
 *   `organization_id = <the job's organization>`, invariant 10), or shared
 *   (`tenancy: { enabled: false }` / `systemFields: { tenant: false }`, read
 *   whole) — else `source_organization_scope_unstated`; and a pull of a
 *   walled source runs in an organization — else `job_organization_missing`.
 *   The scope is read by `externalOrganizationScopeOf` in `@objectstack/core`'s
 *   security module, the one reading the wall and the boot refusal use.
 *
 * ## Where a run starts, and what it commits (ADR-0153 D2, D7)
 *
 * The read position is kept on `sys_sync_run` (`./sync-run-ledger.ts`), per
 * mapping (the package that holds it and its name, ADR-0150 D3) and
 * organization. A run starts from the position the latest committed run
 * stored, when that run read the same source object on the same
 * `watermark.field` into the same target object, and never below
 * `watermark.start`; otherwise, and on every run of a mapping that declares
 * `full: true`, from `watermark.start`.
 * It stores the position it reached at each window's end (invariant 8), so a
 * run that stops part-way keeps its last finished window's position and the
 * next run reads on from there, re-reading only rows that share that canon
 * step (the keyed upsert makes that harmless). A position that cannot be
 * stored stops the pull (`run_record_unavailable`).
 *
 * Delete marking (D3), the provenance columns (D4) and drift (D6) are later
 * changes; their keys stay `planned` in the liveness ledger.
 *
 * ## Every read names its own `limit`
 *
 * The source is read through the protocol's data door (`findData`), which
 * applies the deployment's read limits to a read that names none. A built-in
 * page asks for at most {@link BUILTIN_PAGE_SIZE} rows, fewer when the
 * deployment's maximum page size or row budget is lower, so a page is never
 * refused or cut. A floored window asks for the datasource's row cap: the
 * floor answers at most that many rows or refuses, so the limit never cuts a
 * window, and a deployment whose maximum page is below the cap is refused
 * loudly by the door rather than read short.
 */

import {
    applyMappingToRows,
    buildFieldMetaMap,
    refuseUnknownMappingTargets,
    runImport,
    type ImportRowResult,
    type ImportRunSummary,
    type MappingArtifactLike,
} from '@objectstack/core';
import { needsExternalDriverFloor, resolveExternalRowCap } from '@objectstack/objectql';
import { EXTERNAL_SCOPE_REMEDY, externalOrganizationScopeOf } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { resolveQueryReadLimits, resolveTenancyPosture } from '@objectstack/types';
import type { ConnectorPullDeps, ConnectorPullOptions, SyncRunHandle } from './connector-pull.js';
import {
    BUILTIN_PAGE_SIZE,
    canonOf,
    canonOfStart,
    readSourceInWindows,
    spellCanon,
    type SyncReadPath,
    type SyncWatermarkKind,
    type SyncWindowQuery,
    type SyncWindowSource,
} from './datasource-window-read.js';
// `connector-pull.ts` dispatches here and this reads its blank-key rewrite: a
// cycle of call-time references only, which neither module evaluates at load.
import { refuseBlankMatchKeys } from './connector-pull.js';
import { ConnectorPullError, type ConnectorPullRefusalReason } from './pull-refusal.js';

/** A datasource source's pull: the federated object, its read path and the window positions. */
export interface DatasourcePullResult {
    source: 'datasource';
    mapping: string;
    targetObject: string;
    /** The federated object the rows were read from (`datasourceSource.object`). */
    object: string;
    /** The datasource that object lives on. */
    datasource: string;
    readPath: SyncReadPath;
    /** The window field, where the read started, and the position the run committed (absent when it wrote no row). */
    watermark: { field: string; from: string | number; committed?: string | number };
    /** Rows the windows answered. */
    pulled: number;
    /**
     * The import runner's counters for every batch, summed. `results` holds at
     * most {@link REFUSED_ROW_SAMPLE} refused rows, never one result per row read.
     */
    summary: ImportRunSummary;
}

type Rec = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

const single = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    return Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' ? v[0] : undefined;
};

/** The field definition `name` of an object definition, whichever of the two `fields` shapes it uses. */
function fieldOf(def: unknown, name: string): Rec | undefined {
    const fields = isPlainObject(def) ? def.fields : undefined;
    if (Array.isArray(fields)) return fields.find((f) => isPlainObject(f) && f.name === name) as Rec | undefined;
    const field = isPlainObject(fields) ? fields[name] : undefined;
    return isPlainObject(field) ? field : undefined;
}

/** An object definition as the protocol serves it, or `undefined`. */
async function readObject(deps: ConnectorPullDeps, name: string, environmentId?: string): Promise<Rec | undefined> {
    try {
        const r = await deps.protocol.getMetaItem({ type: 'object', name }) as Rec | undefined;
        if (isPlainObject(r?.item)) return r.item;
        if (typeof deps.protocol.getObjectSchema === 'function') {
            const schema = await deps.protocol.getObjectSchema(name, environmentId);
            if (isPlainObject(schema)) return schema;
        }
    } catch { /* judged as absent below */ }
    return undefined;
}

/** The window field's class (invariant 1), or `undefined` for a field no window can be halved on. */
function watermarkKindOf(field: Rec | undefined): SyncWatermarkKind | undefined {
    if (!field) return undefined;
    if (field.type === 'datetime') return 'datetime';
    if (field.type === 'date') return 'date';
    if (field.type === 'number' && field.scale === 0) return 'integer';
    return undefined;
}

/**
 * Pull one mapping's `datasourceSource`. Throws {@link ConnectorPullError} on
 * every refusal: before the first read for a binding no pull could honour,
 * part-way for a value or a window the read cannot get past (the windows read
 * to their end before it stay written, with the position they committed).
 * `run` is the pull's run record (`./connector-pull.ts` opens and closes it):
 * the position is read from it and committed through it.
 */
export async function pullDatasourceSource(
    deps: ConnectorPullDeps,
    opts: ConnectorPullOptions,
    artifact: MappingArtifactLike & { datasourceSource: Rec },
    run: SyncRunHandle,
): Promise<DatasourcePullResult> {
    const { protocol, logger } = deps;
    const { context, environmentId } = opts;
    const mapping = opts.mapping;
    const refuse = (code: string, status: number, reason: ConnectorPullRefusalReason, message: string): never => {
        throw new ConnectorPullError({ code, status, reason, mapping }, message);
    };
    const invalid = (reason: ConnectorPullRefusalReason, message: string): never =>
        refuse('VALIDATION_ERROR', 400, reason, `Mapping "${mapping}": ${message}`);

    const ds = artifact.datasourceSource;
    const wm = isPlainObject(ds.watermark) ? ds.watermark : undefined;
    const sourceObject = typeof ds.object === 'string' ? ds.object : undefined;
    const wmName = typeof wm?.field === 'string' ? wm.field : undefined;
    if (!sourceObject || !wmName || wm?.start === undefined) {
        // [N4] The binding is there but unusable: the datasource source's own reason.
        return invalid('source_binding_invalid',
            'datasourceSource names no object or no watermark { field, start }, so there is nothing to read; '
            + "write datasourceSource: { object: '<federated object>', watermark: { field, start } }");
    }
    const targetObject = artifact.targetObject;

    // The write semantics, as the connector pull and the parse refinement judge them.
    const matchFields = Array.isArray(artifact.upsertKey)
        ? artifact.upsertKey.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : [];
    if (artifact.mode !== 'upsert' || matchFields.length === 0) {
        return invalid('upsert_key_empty',
            "a sourced mapping writes in mode 'upsert' with an upsertKey; a pull reads the same rows again on every run, "
            + 'so any other mode duplicates or drops them. Write mode: \'upsert\' and name the upsertKey.');
    }
    if (artifact.fieldMapping.some((entry) => entry?.transform === 'javascript')) {
        return refuse('UNSUPPORTED_TRANSFORM', 400, 'unsupported_transform',
            `Mapping "${mapping}" uses transform "javascript", which a pull does not execute (no server-side sandbox)`);
    }

    // The target: a `synced` object (D4), its fields the import door's.
    const target = await readObject(deps, targetObject, environmentId);
    if (!target) {
        return invalid('mapping_target_refused', `targetObject '${targetObject}' is not a registered object`);
    }
    if (target.managedBy !== 'synced') {
        return invalid('mapping_target_refused',
            `targetObject '${targetObject}' is not managedBy: 'synced' (it is `
            + `${target.managedBy === undefined ? 'unset' : `'${String(target.managedBy)}'`}). A pulled copy is read-only `
            + "to members, so a member's edit is never kept or lost silently by the next pull; declare managedBy: 'synced' on it.");
    }
    const refusedTarget = refuseUnknownMappingTargets(artifact, targetObject, target);
    if (refusedTarget) {
        return refuse(refusedTarget.code, refusedTarget.status, 'mapping_target_refused', `Mapping "${mapping}": ${refusedTarget.error}`);
    }

    // The source: a federated object on a non-managed datasource (D1).
    const source = await readObject(deps, sourceObject, environmentId);
    const at = `datasourceSource.object '${sourceObject}'`;
    if (!source) return invalid('source_binding_invalid', `${at} is not a registered object, so there is nothing to read`);
    const external = isPlainObject(source.external) ? source.external : undefined;
    if (!external) {
        return invalid('source_binding_invalid',
            `${at} is not federated: it declares no external binding (ADR-0015), so its rows are already local `
            + 'and there is nothing to copy. Name a federated object.');
    }
    const datasource = typeof source.datasource === 'string' && source.datasource ? source.datasource : undefined;
    let datasourceDef: Rec | undefined;
    if (datasource) {
        try {
            const r = await protocol.getMetaItem({ type: 'datasource', name: datasource }) as Rec | undefined;
            if (isPlainObject(r?.item)) datasourceDef = r.item;
        } catch { /* judged below */ }
    }
    if (!datasource || !datasourceDef) {
        return invalid('source_binding_invalid',
            `${at} names ${datasource ? `datasource '${datasource}', whose definition could not be read` : 'no datasource'}, `
            + 'so whether its driver is read whole or through the engine\'s floor cannot be decided. Declare the '
            + 'datasource the object lives on.');
    }
    if (datasourceDef.schemaMode === undefined || datasourceDef.schemaMode === 'managed') {
        return invalid('source_binding_invalid',
            `${at} lives on datasource '${datasource}', whose schemaMode is managed: its rows are already local, so `
            + 'a pull would copy rows the platform already owns. Name an object on an external or validate-only datasource.');
    }
    const readPath: SyncReadPath = needsExternalDriverFloor(datasourceDef) ? 'floored' : 'builtin';

    // Invariant 6: the key is the column the binding maps onto `id`.
    const columnMap = isPlainObject(external.columnMap) ? external.columnMap : {};
    if (!Object.values(columnMap).includes('id')) {
        return invalid('source_key_missing',
            `source_key_missing — ${at}'s external.columnMap maps no remote column onto 'id', so the pull has no key `
            + "to match a row's copy by or to page by. Map the source's unique, never-null key column onto id.");
    }

    // Invariant 1: the window field.
    const wmField = fieldOf(source, wmName);
    const kind = watermarkKindOf(wmField);
    if (!kind) {
        return invalid('source_binding_invalid',
            `watermark.field '${wmName}' is ${wmField ? `of type '${String(wmField.type)}'${wmField.type === 'number' ? ' without scale: 0' : ''}` : 'not a field of the source object'}, `
            + 'which a read window cannot be cut and halved on. Name a datetime or date field, or a number field that '
            + 'declares scale: 0.');
    }

    // D3: the watermark is copied unchanged onto a target field of its type.
    const copied = artifact.fieldMapping.some((entry) => {
        if ((entry?.transform ?? 'none') !== 'none' || single(entry.source) !== wmName) return false;
        const name = single(entry.target);
        return name !== undefined && !name.includes('.') && fieldOf(target, name)?.type === wmField?.type;
    });
    if (!copied) {
        return invalid('watermark_field_unmapped',
            `watermark_field_unmapped — no fieldMapping entry copies watermark.field '${wmName}' unchanged (transform `
            + `none) onto a ${String(wmField?.type)} field of '${targetObject}'. Every pulled row carries its watermark `
            + `value; add { source: '${wmName}', target: FIELD } to fieldMapping, FIELD naming such a field.`);
    }

    // [D8] Whose rows the pull reads: the job's organization's, or every row of a shared source.
    const scope = organizationScope(source, context, at, invalid);

    const windowSource: SyncWindowSource = {
        mapping, object: sourceObject, datasource, field: wmName, kind, key: 'id', ...(scope ? { scope } : {}),
    };
    // [D7] Where the run starts: the position the latest committed run of this
    // mapping (its holder package and name) in this organization stored, when
    // it read this source object on this field into this target, and never
    // below `watermark.start`. `full: true`, a first run, or a position from
    // another source, field or target starts at `watermark.start`.
    const start = canonOfStart(windowSource, wm.start);
    const previous = ds.full === true ? undefined : await run.lastCommitted();
    let from = start;
    let resumed: string | undefined;
    const sameRead = previous !== undefined && previous.source === sourceObject && previous.watermarkField === wmName;
    if (previous && sameRead && previous.targetObject === targetObject) {
        const reading = canonOf(kind, previous.position);
        if (reading.ok) {
            from = Math.max(reading.canon, start);
            resumed = previous.runId;
        }
    }
    await run.describe({
        sourceKind: 'datasource', source: sourceObject, datasource, readPath, watermarkField: wmName, from: spellCanon(kind, from),
    });
    const limits = resolveQueryReadLimits();
    const pageSize = Math.min(BUILTIN_PAGE_SIZE, limits.maxPageSize ?? Infinity, limits.rowBudget ?? Infinity);
    const windowLimit = resolveExternalRowCap(isPlainObject(datasourceDef.external) ? datasourceDef.external.rowCap : undefined);
    const readContext = context ?? { isSystem: true };

    const find = async (query: SyncWindowQuery): Promise<Rec[]> => {
        const res = await protocol.findData({
            object: sourceObject,
            query: {
                object: sourceObject,
                where: query.where,
                ...(query.orderBy ? { orderBy: query.orderBy } : {}),
                limit: query.limit ?? windowLimit,
                // [S3] The pull reads `records` only. Without this the data door
                // runs `engine.count` over the same `where` beside every read that
                // names a `limit` — on the floored path the floor's count is the
                // window fetched from the remote a second time.
                count: false,
            },
            context: readContext,
            ...(environmentId ? { environmentId } : {}),
        });
        return Array.isArray(res) ? res : Array.isArray(res?.records) ? res.records : [];
    };

    // [S2] The run's report: the counters of every batch summed, and at most
    // REFUSED_ROW_SAMPLE refused rows kept for the log — never one result per
    // source row, which would grow with the table and be copied on every batch.
    const summary = emptySummary();
    const trimWhitespace = true;
    const metaMap = buildFieldMetaMap(target);
    const write = async (rows: Rec[]): Promise<boolean[]> => {
        const applied = applyMappingToRows(rows, artifact, { objectSchema: target, trimWhitespace });
        if (!applied.ok) {
            return refuse(applied.code, applied.status, 'mapping_apply_refused', `Mapping "${mapping}": ${applied.error}`);
        }
        const ran = await runImport({
            p: protocol,
            objectName: targetObject,
            environmentId,
            context,
            rows: applied.rows as Array<Record<string, any>>,
            metaMap,
            writeMode: 'upsert',
            matchFields,
            dryRun: false,
            runAutomations: true,
            treatAsHistorical: false,
            trimWhitespace,
            createMissingOptions: false,
            skipBlankMatchKey: true,
        });
        const batch = refuseBlankMatchKeys(ran, mapping, matchFields).summary;
        addBatch(summary, batch);
        // [D7] What a run that stops part-way is closed with.
        run.progress.read += rows.length;
        run.progress.created = summary.created;
        run.progress.updated = summary.updated;
        run.progress.refused = summary.errors;
        return rows.map((_, i) => isWritten(batch.results[i]));
    };
    // [D7, invariant 8] Called only at a window's end: the position is stored
    // before the next window is read, so a run that stops keeps it.
    const commit = async (position: number): Promise<void> => run.commit(spellCanon(kind, position));

    logger.info(
        `[Automation] datasource pull: mapping "${mapping}" ← ${sourceObject} (datasource '${datasource}', ${readPath} read, `
        + `windows on ${wmName} from ${JSON.stringify(spellCanon(kind, from))}, `
        + `${resumed ? `the position run ${resumed} committed` : ds.full === true ? 'watermark.start: full: true' : 'watermark.start'})`,
    );
    const report = await readSourceInWindows(windowSource, { find, write, commit }, {
        path: readPath, from, pageSize,
    });

    return {
        source: 'datasource',
        mapping,
        targetObject,
        object: sourceObject,
        datasource,
        readPath,
        watermark: {
            field: wmName,
            from: spellCanon(kind, from),
            ...(report.committed !== undefined ? { committed: spellCanon(kind, report.committed) } : {}),
        },
        pulled: report.read,
        summary,
    };
}

/**
 * [D8, invariant 10] The organization conjunct every read carries, or none.
 * Under a walled posture a source with its own `organization_id` is read for
 * the job's organization only, a shared source is read whole, and a source
 * that states no scope is refused. Under `single` there is no wall.
 */
function organizationScope(
    source: Rec,
    context: unknown,
    at: string,
    invalid: (reason: ConnectorPullRefusalReason, message: string) => never,
): Record<string, unknown> | undefined {
    if (!postureEnforcesWall(resolveTenancyPosture())) return undefined;
    const declared = externalOrganizationScopeOf(source);
    if (declared === 'shared' || declared === null) return undefined;
    if (declared !== 'walled') {
        return invalid('source_organization_scope_unstated',
            `source_organization_scope_unstated — ${at} states no organization scope this deployment's organization `
            + `wall can read, so the pull cannot tell whose rows it may copy. ${EXTERNAL_SCOPE_REMEDY}`);
    }
    const tenantId = isPlainObject(context) && typeof context.tenantId === 'string' && context.tenantId
        ? context.tenantId : undefined;
    if (!tenantId) {
        return invalid('job_organization_missing',
            `${at} is walled by organization and this deployment runs a walled tenancy posture, but the pull runs in no `
            + 'organization, so it cannot tell whose rows to copy. Declare the organization the job runs in: '
            + "organization: '<sys_organization.id>' on the job — one job per organization.");
    }
    return { organization_id: tenantId };
}

function isWritten(result: ImportRowResult | undefined): boolean {
    return result?.ok === true && (result.action === 'created' || result.action === 'updated');
}

/**
 * [S2] The most refused rows a pull's summary keeps, in read order — enough
 * for the log line and a caller that wants an example of what was refused; the
 * counters carry every row. `ConnectorSourcePullSummary`, the part of the
 * report the contract hands a caller, is the counters alone.
 */
export const REFUSED_ROW_SAMPLE = 20;

function emptySummary(): ImportRunSummary {
    return { total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, ok: 0, results: [], cancelled: false } as ImportRunSummary;
}

/**
 * Fold one batch's report into the run's: the counters summed, and the batch's
 * refused rows added to the sample until it holds {@link REFUSED_ROW_SAMPLE},
 * renumbered to their place in the run. Nothing else of the batch is kept.
 */
function addBatch(run: ImportRunSummary, batch: ImportRunSummary): void {
    const offset = run.total;
    run.total += batch.total;
    run.processed += batch.processed;
    run.created += batch.created;
    run.updated += batch.updated;
    run.skipped += batch.skipped;
    run.errors += batch.errors;
    run.ok += batch.ok;
    run.cancelled = run.cancelled || batch.cancelled;
    for (const r of batch.results) {
        if (run.results.length >= REFUSED_ROW_SAMPLE) break;
        if (r.ok === false) run.results.push({ ...r, row: r.row + offset });
    }
}
