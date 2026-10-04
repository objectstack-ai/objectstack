// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector sync executor (#20919 — stage ② of the connector-sync ruling
 * on #20281): pull the records a `mapping`'s `connectorSource` names and write
 * them through the bulk-import runner.
 *
 * A sync is defined on its TARGET. The `mapping` already names the object it
 * writes (`targetObject`), the field map (`fieldMapping`) and the write
 * semantics (`mode`, `upsertKey`); `connectorSource` adds only where the rows
 * come from. So a pull is the import door with a different reader:
 *
 *   1. read the mapping through the protocol's `getMetaItem` — the read the
 *      import door's `mappingName` makes;
 *   2. resolve `connectorSource.connector` to a DECLARED `rest` / `openapi`
 *      instance (`connectors[]`, materialized by this plugin), and its action;
 *   3. W1 watermark: read the highest value already written to the target
 *      field `fieldMapping` maps `watermark.field` onto, and send it as the
 *      action's `query[watermark.param]`;
 *   4. make ONE action call and read the records at `recordsPath`;
 *   5. project them through the mapping (`applyMappingToRows`) and write them
 *      with `runImport` — the runner, coercion and row verdicts the import
 *      door uses, so a synced row and an uploaded row speak one vocabulary.
 *
 * ⛔ One response per pull. The connector's own paging is not followed: no
 * paging convention is declared, and inventing one is the stop valve. The
 * limit is stated where authors read it (`mapping.zod.ts`'s `watermark`
 * describe and `SYNC_ARCHITECTURE.md`).
 *
 * ⛔ Nothing here schedules a pull. A `job` whose `pull` names the mapping
 * drives it (`JobSchema.pull`): the runtime's job binder calls the `automation`
 * service's `pullConnectorSource` (the `IAutomationService` contract method)
 * on each run, and hands in the execution context the pull reads and writes
 * under — `{ isSystem: true, tenantId }` from the job's declared
 * `organization`, or `{ isSystem: true }` where it declares none.
 *
 * Every refusal is loud and typed ({@link ConnectorPullError}): a pull that
 * cannot honour its binding throws before anything is written, and the
 * `reason` names which part of the binding failed. The `code` is a member of
 * the standard catalog (or the code the import door already answers with for
 * the same condition), so no new wire vocabulary is minted for a door that
 * does not exist yet.
 */

import {
    applyMappingToRows,
    buildFieldMetaMap,
    refuseUnknownMappingTargets,
    runImport,
    type ImportProtocolLike,
    type ImportRunSummary,
    type MappingArtifactLike,
    type MappingFailure,
} from '@objectstack/core';
import type { AutomationContext, Logger } from '@objectstack/spec/contracts';
import type { ConnectorOrigin } from '@objectstack/spec/integration';
import type { ConnectorActionHandler } from './engine.js';

/** The connector providers a v1 pull reads through (the ruling's "rest / openapi only"). */
export const CONNECTOR_PULL_PROVIDERS: readonly string[] = Object.freeze(['rest', 'openapi']);

/** Which part of the binding a refused pull failed on. */
export type ConnectorPullRefusalReason =
    | 'mapping_not_found'
    | 'no_connector_source'
    | 'connector_not_registered'
    | 'connector_plugin_origin'
    | 'connector_degraded'
    | 'connector_provider_unsupported'
    | 'connector_action_unknown'
    | 'upsert_key_empty'
    | 'unsupported_transform'
    | 'watermark_field_unmapped'
    | 'input_query_not_object'
    | 'mapping_target_refused'
    | 'upstream_not_ok'
    | 'records_not_array'
    | 'record_not_object'
    | 'mapping_apply_refused';

/**
 * A refused pull. `code` + `status` are the ADR-0112 pair a door would put on
 * the wire; `reason` is the machine discriminator a caller branches on; the
 * message names the mapping and says what to change.
 */
export class ConnectorPullError extends Error {
    readonly code: string;
    readonly status: number;
    readonly reason: ConnectorPullRefusalReason;
    readonly mapping: string;

    constructor(
        init: { code: string; status: number; reason: ConnectorPullRefusalReason; mapping: string },
        message: string,
    ) {
        super(message);
        this.name = 'ConnectorPullError';
        this.code = init.code;
        this.status = init.status;
        this.reason = init.reason;
        this.mapping = init.mapping;
    }
}

/** The protocol surface a pull reads and writes through: the import runner's, plus the metadata read. */
export interface ConnectorPullProtocol extends ImportProtocolLike {
    getMetaItem(request: { type: string; name: string }): Promise<unknown>;
    getObjectSchema?(objectName: string, environmentId?: string): Promise<unknown>;
}

/** The connector registry a pull resolves through — the automation engine's. */
export interface ConnectorPullRegistry {
    resolveConnectorAction(connectorId: string, actionId: string): ConnectorActionHandler | undefined;
    getConnectorOrigin(name: string): ConnectorOrigin | undefined;
    getConnectorDegradedReason(name: string): string | undefined;
}

export interface ConnectorPullDeps {
    protocol: ConnectorPullProtocol;
    registry: ConnectorPullRegistry;
    /**
     * The provider a declared (`connectors[]`) instance was materialized by —
     * recorded by the automation plugin when it registers the instance. The
     * registered connector definition carries no provider key, so this is the
     * one place the answer lives.
     */
    providerOf(connector: string): string | undefined;
    logger: Logger;
}

export interface ConnectorPullOptions {
    /** Name of the `mapping` whose `connectorSource` is pulled. */
    mapping: string;
    /** Execution context the target read and the writes run under — the caller's (a `job`'s, built from its `organization`). */
    context?: any;
    environmentId?: string;
    /** Automation context handed to the connector action, as a flow node would hand it. */
    automation?: AutomationContext;
}

export interface ConnectorPullResult {
    mapping: string;
    targetObject: string;
    connector: string;
    action: string;
    /**
     * The incremental half, when `connectorSource.watermark` is declared:
     * `from` is the starting point sent as `query[param]` — the highest value
     * of `target` already written — or `undefined` on the first pull, which
     * reads the full set.
     */
    watermark?: { field: string; target: string; param: string; from: unknown };
    /** Records the one action response carried. */
    pulled: number;
    /** The import runner's report for the write. */
    summary: ImportRunSummary;
}

/** `connectorSource` as a stored mapping carries it (raw; the spec shape is `MappingSchema.connectorSource`). */
interface ConnectorSourceLike {
    connector?: unknown;
    action?: unknown;
    input?: unknown;
    recordsPath?: unknown;
    watermark?: { field?: unknown; param?: unknown };
}

type PulledMapping = MappingArtifactLike & { connectorSource?: ConnectorSourceLike };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

const first = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

/**
 * The target field a `fieldMapping` entry copies `field` onto, unchanged —
 * the only entry whose target holds the pulled watermark value as it was
 * pulled. A transformed entry (`map`, `split`, `join`, `constant`, `lookup`)
 * writes something else, and a compound-field part is not a column a single
 * read can order by.
 */
function watermarkTarget(artifact: MappingArtifactLike, field: string): string | undefined {
    for (const entry of artifact.fieldMapping) {
        const transform = entry.transform ?? 'none';
        if (transform !== 'none') continue;
        if (first(entry.source) !== field) continue;
        const target = first(entry.target);
        if (typeof target === 'string' && target.length > 0 && !target.includes('.')) return target;
    }
    return undefined;
}

/** Walk a dot path inside the action result (`body.results`). */
function atPath(value: unknown, path: string): unknown {
    let at: unknown = value;
    for (const segment of path.split('.')) {
        if (!isPlainObject(at)) return undefined;
        at = at[segment];
    }
    return at;
}

function shapeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * Pull one `mapping`'s `connectorSource` and write what it returns. Throws
 * {@link ConnectorPullError} on every refusal, before anything is written.
 */
export async function pullConnectorSource(
    deps: ConnectorPullDeps,
    opts: ConnectorPullOptions,
): Promise<ConnectorPullResult> {
    const { protocol, registry, logger } = deps;
    const { context, environmentId } = opts;
    const mappingName = opts.mapping;
    const refuse = (
        code: string,
        status: number,
        reason: ConnectorPullRefusalReason,
        message: string,
    ): never => {
        throw new ConnectorPullError({ code, status, reason, mapping: mappingName }, message);
    };
    const refuseWith = (failure: MappingFailure, reason: ConnectorPullRefusalReason): never =>
        refuse(failure.code, failure.status, reason, `Mapping "${mappingName}": ${failure.error}`);

    // 1. The mapping, read as the import door reads a `mappingName`.
    let artifact: PulledMapping | undefined;
    try {
        const res = await protocol.getMetaItem({ type: 'mapping', name: mappingName }) as Record<string, unknown> | undefined;
        artifact = res?.item as PulledMapping | undefined;
    } catch { /* treated as not found below */ }
    if (!isPlainObject(artifact) || !Array.isArray(artifact.fieldMapping) || typeof artifact.targetObject !== 'string') {
        return refuse('MAPPING_NOT_FOUND', 404, 'mapping_not_found', `No mapping artifact named "${mappingName}" is registered`);
    }
    const source = artifact.connectorSource;
    if (!isPlainObject(source) || typeof source.connector !== 'string' || typeof source.action !== 'string') {
        return refuse(
            'VALIDATION_ERROR', 400, 'no_connector_source',
            `Mapping "${mappingName}" declares no connectorSource, so there is nothing to pull; `
            + 'add `connectorSource: { connector, action }` naming a rest or openapi connector',
        );
    }
    const connector = source.connector;
    const action = source.action;
    const objectName = artifact.targetObject;

    // 2. The connector: a DECLARED rest/openapi instance, and its action.
    const origin = registry.getConnectorOrigin(connector);
    if (origin === undefined) {
        return refuse(
            'VALIDATION_ERROR', 400, 'connector_not_registered',
            `Mapping "${mappingName}" pulls from connector "${connector}", which is not registered; `
            + 'declare it as a `connectors[]` entry with provider `rest` or `openapi`',
        );
    }
    if (origin !== 'declarative') {
        return refuse(
            'VALIDATION_ERROR', 400, 'connector_plugin_origin',
            `Mapping "${mappingName}" pulls from connector "${connector}", which a plugin registered in code, `
            + 'not a `connectors[]` entry; a pull reads only a declared rest or openapi instance',
        );
    }
    const degraded = registry.getConnectorDegradedReason(connector);
    if (degraded !== undefined) {
        return refuse(
            'SERVICE_UNAVAILABLE', 503, 'connector_degraded',
            `Mapping "${mappingName}" pulls from connector "${connector}", which is degraded (${degraded}); `
            + 'nothing was pulled',
        );
    }
    const provider = deps.providerOf(connector);
    if (provider === undefined || !CONNECTOR_PULL_PROVIDERS.includes(provider)) {
        return refuse(
            'VALIDATION_ERROR', 400, 'connector_provider_unsupported',
            `Mapping "${mappingName}" pulls from connector "${connector}", whose provider is `
            + `${provider === undefined ? 'unknown' : `"${provider}"`}; a pull reads only a rest or openapi connector`,
        );
    }
    const handler = registry.resolveConnectorAction(connector, action);
    if (!handler) {
        return refuse(
            'VALIDATION_ERROR', 400, 'connector_action_unknown',
            `Mapping "${mappingName}" calls action "${action}", which connector "${connector}" does not declare`,
        );
    }

    // 3. The write semantics, checked as the import door checks them.
    const writeMode: 'insert' | 'update' | 'upsert' =
        artifact.mode === 'update' || artifact.mode === 'upsert' ? artifact.mode : 'insert';
    const matchFields = Array.isArray(artifact.upsertKey)
        ? artifact.upsertKey.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : [];
    if (writeMode !== 'insert' && matchFields.length === 0) {
        return refuse(
            'VALIDATION_ERROR', 400, 'upsert_key_empty',
            `Mapping "${mappingName}" writes in mode "${writeMode}" but declares no upsertKey; `
            + 'name the field(s) that match a pulled record to a stored one',
        );
    }
    for (const entry of artifact.fieldMapping) {
        if (entry?.transform === 'javascript') {
            return refuse(
                'UNSUPPORTED_TRANSFORM', 400, 'unsupported_transform',
                `Mapping "${mappingName}" uses transform "javascript", which a pull does not execute (no server-side sandbox)`,
            );
        }
    }

    // 4. The watermark (W1): read from the TARGET, never stored elsewhere.
    const declaredWatermark = isPlainObject(source.watermark) ? source.watermark : undefined;
    let watermark: ConnectorPullResult['watermark'];
    if (declaredWatermark) {
        const field = String(declaredWatermark.field);
        const param = String(declaredWatermark.param);
        const target = watermarkTarget(artifact, field);
        if (!target) {
            return refuse(
                'VALIDATION_ERROR', 400, 'watermark_field_unmapped',
                `Mapping "${mappingName}" declares watermark.field "${field}", but no fieldMapping entry copies `
                + `"${field}" unchanged onto a field of "${objectName}"; the next pull's starting point is read `
                + 'from that target field, so map it (transform `none`)',
            );
        }
        if (source.input !== undefined && !isPlainObject(source.input)) {
            return refuse(
                'VALIDATION_ERROR', 400, 'input_query_not_object',
                `Mapping "${mappingName}" declares connectorSource.input as ${shapeOf(source.input)}; it must be an object`,
            );
        }
        const query = isPlainObject(source.input) ? source.input.query : undefined;
        if (query !== undefined && !isPlainObject(query)) {
            return refuse(
                'VALIDATION_ERROR', 400, 'input_query_not_object',
                `Mapping "${mappingName}" declares connectorSource.input.query as ${shapeOf(query)}; the watermark `
                + `parameter "${param}" is added to it, so it must be an object`,
            );
        }
        const read = await protocol.findData({
            object: objectName,
            query: {
                object: objectName,
                where: { [target]: { $ne: null } },
                orderBy: [{ field: target, order: 'desc' }],
                limit: 1,
            },
            ...(context ? { context } : {}),
            ...(environmentId ? { environmentId } : {}),
        });
        const rows = Array.isArray(read) ? read : Array.isArray(read?.records) ? read.records : [];
        const stored = rows[0]?.[target];
        const from = stored instanceof Date ? stored.toISOString() : stored ?? undefined;
        watermark = { field, target, param, from };
    }

    // 5. The object's definition — the door's read, for the target refusal,
    //    compound-part assembly and cell coercion alike.
    let schema: unknown;
    try {
        const r = await protocol.getMetaItem({ type: 'object', name: objectName }) as Record<string, unknown> | undefined;
        schema = r?.item;
        if (!schema && typeof protocol.getObjectSchema === 'function') {
            schema = await protocol.getObjectSchema(objectName, environmentId);
        }
    } catch { /* judged by nobody, coerced as pass-through — the door's rule */ }
    const refusedTarget = refuseUnknownMappingTargets(artifact, objectName, schema);
    if (refusedTarget) return refuseWith(refusedTarget, 'mapping_target_refused');

    // 6. ONE action call.
    const input: Record<string, unknown> = isPlainObject(source.input) ? { ...source.input } : {};
    if (watermark && watermark.from !== undefined) {
        input.query = { ...(isPlainObject(input.query) ? input.query : {}), [watermark.param]: watermark.from };
    }
    logger.info(
        `[Automation] connector pull: mapping "${mappingName}" ← ${connector}.${action}`
        + (watermark ? ` (watermark ${watermark.target} from ${watermark.from === undefined ? 'the start' : String(watermark.from)})` : ''),
    );
    const result = await handler(input, { variables: new Map(), automation: opts.automation ?? {}, logger });
    if (!isPlainObject(result) || result.ok === false) {
        const status = isPlainObject(result) ? result.status : undefined;
        return refuse(
            'EXTERNAL_SERVICE_ERROR', 502, 'upstream_not_ok',
            `Mapping "${mappingName}": ${connector}.${action} answered ok:false`
            + (status === undefined ? '' : ` (status ${String(status)})`) + '; nothing was written',
        );
    }
    const recordsPath = typeof source.recordsPath === 'string' ? source.recordsPath : 'body';
    const records = atPath(result, recordsPath);
    if (!Array.isArray(records)) {
        return refuse(
            'INTEGRATION_ERROR', 502, 'records_not_array',
            `Mapping "${mappingName}": ${connector}.${action}'s result holds ${shapeOf(records)} at "${recordsPath}", `
            + 'not an array of records; point connectorSource.recordsPath at the array',
        );
    }
    const badAt = records.findIndex((r) => !isPlainObject(r));
    if (badAt >= 0) {
        return refuse(
            'INTEGRATION_ERROR', 502, 'record_not_object',
            `Mapping "${mappingName}": record ${badAt} at "${recordsPath}" is ${shapeOf(records[badAt])}, not an object`,
        );
    }

    // 7. Project and write — the import door's pipeline and runner, with the
    //    door's defaults for every knob `connectorSource` does not declare.
    const trimWhitespace = true;
    const applied = applyMappingToRows(records as Array<Record<string, unknown>>, artifact, {
        objectSchema: schema,
        trimWhitespace,
    });
    if (!applied.ok) return refuseWith(applied, 'mapping_apply_refused');

    const summary = await runImport({
        p: protocol,
        objectName,
        environmentId,
        context,
        rows: applied.rows as Array<Record<string, any>>,
        metaMap: buildFieldMetaMap(schema),
        writeMode,
        matchFields,
        dryRun: false,
        runAutomations: true,
        treatAsHistorical: false,
        trimWhitespace,
        createMissingOptions: false,
        skipBlankMatchKey: false,
    });

    return {
        mapping: mappingName,
        targetObject: objectName,
        connector,
        action,
        ...(watermark ? { watermark } : {}),
        pulled: records.length,
        summary,
    };
}
