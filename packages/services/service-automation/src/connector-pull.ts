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
 *   1. read the mapping by name (ADR-0150 D3): a pull that names its
 *      package (`callerPackageId`) reads through the injected package-scoped
 *      resolver (`mappingByPackage`) from that package; one that names none
 *      reads through the protocol's `getMetaItem`, the read the import door's
 *      `mappingName` makes;
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
 *
 * [ADR-0153 D7] Every pull, either source, leaves one `sys_sync_run` row
 * through the ledger the caller hands in (`deps.runs`, `./sync-run-ledger.ts`):
 * opened `running` before the mapping is read, closed `completed`, `degraded`
 * (rows the runner refused) or `failed` (the refusal's `reason` and sentence)
 * when the pull ends, and one log line says how it ended, with its counts.
 * A ledger that cannot open the run refuses the pull before anything is read
 * (`run_record_unavailable`): a datasource pull whose read position cannot be
 * stored would read from `watermark.start` every time.
 */

import {
    PackageScopedNameRefusedError,
    RUNTIME_COMPATIBILITY_PACKAGE_ID,
    applyMappingToRows,
    buildFieldMetaMap,
    refuseUnknownMappingTargets,
    runImport,
    type ImportProtocolLike,
    type ImportRunSummary,
    type MappingArtifactLike,
    type MappingFailure,
    type PackageScopedHolder,
    type PackageScopedResolution,
} from '@objectstack/core';
import type { AutomationContext, Logger } from '@objectstack/spec/contracts';
import { SystemObjectName } from '@objectstack/spec/system';
import type { ConnectorOrigin } from '@objectstack/spec/integration';
import type { ConnectorActionHandler } from './engine.js';
import {
    findConnectorActionInputSchema,
    judgeConnectorInput,
    type ConnectorInputSchemaSource,
} from './connector-input-schema.js';
import { ConnectorPullError, type ConnectorPullRefusalReason } from './pull-refusal.js';
import { pullDatasourceSource, type DatasourcePullResult } from './datasource-pull.js';
import {
    SYNC_RUN_OBJECT,
    type SyncRunCounts,
    type SyncRunDescription,
    type SyncRunLedger,
    type SyncRunPosition,
    type SyncRunScope,
} from './sync-run-ledger.js';

/** The connector providers a v1 pull reads through (the ruling's "rest / openapi only"). */
export const CONNECTOR_PULL_PROVIDERS: readonly string[] = Object.freeze(['rest', 'openapi']);

// The refusal a pull throws, and its reason union, live in `./pull-refusal.ts`
// so the datasource source's windowed read (`./datasource-window-read.ts`)
// throws the same type without importing this module.
export { ConnectorPullError, type ConnectorPullRefusalReason } from './pull-refusal.js';

/** The protocol surface a pull reads and writes through: the import runner's, plus the metadata read. */
export interface ConnectorPullProtocol extends ImportProtocolLike {
    getMetaItem(request: { type: string; name: string }): Promise<unknown>;
    getObjectSchema?(objectName: string, environmentId?: string): Promise<unknown>;
}

/**
 * The connector registry a pull resolves through — the automation engine's.
 * Its descriptor list is where the action's declared `inputSchema` is read
 * (#28040), the read the `connector_action` node makes.
 */
export interface ConnectorPullRegistry extends ConnectorInputSchemaSource {
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
    /**
     * [ADR-0150 D3, #32071] The mapping read for a caller of a package
     * (`mappingNameResolver`, `./connector-package-scope.ts`): own item, else
     * the one holder in the package's closure plus `sys`, else a refusal.
     * Absent, or answering `undefined` (no registry to ask), and the pull
     * reads by no package through `protocol`, as a pull naming no package does.
     */
    mappingByPackage?: (name: string, callerPackageId: string) => PackageScopedResolution | undefined;
    /**
     * [ADR-0153 D7] The `sys_sync_run` ledger: the run record every pull
     * writes, and the read position a datasource pull starts from. Absent, a
     * pull writes no run record and a datasource pull keeps no position, so
     * every run reads from `watermark.start` (the plugin says so once).
     */
    runs?: SyncRunLedger;
}

/** [ADR-0153 D7, ADR-0150 D3] What a pull resolved its mapping to: the key, beside the name, its read position is kept by. */
export interface SyncRunMappingIdentity {
    /** The package that holds the mapping: the holder, not the caller. Absent for the environment's own mapping. */
    mappingPackage?: string;
    targetObject: string;
}

/**
 * [ADR-0153 D7] The run record of one pull, as the two executors see it. With
 * no ledger, every method answers nothing and stores nothing.
 */
export interface SyncRunHandle {
    /** The `sys_sync_run` id, when a ledger keeps the run. */
    readonly id: string | undefined;
    /** The run's key: the mapping name and organization, and once identified the holder package. */
    readonly scope: SyncRunScope;
    /** The mapping's `targetObject`, once identified. */
    readonly targetObject: string | undefined;
    /**
     * Record what the pull resolved the mapping to (ADR-0150 D3): the package
     * that holds it, and its target. Writes nothing; every later read and
     * write of the run is scoped by it, and {@link describe} stores it.
     */
    identify(identity: SyncRunMappingIdentity): void;
    /** Say what the run reads, once the mapping's source is known. */
    describe(description: SyncRunDescription): Promise<void>;
    /** The position the latest committed run of this mapping (its package and name) in this organization stored. */
    lastCommitted(): Promise<SyncRunPosition | undefined>;
    /** Store the position the run reached at a window's end (ADR-0153 D2, invariant 8). */
    commit(position: string | number): Promise<void>;
    /** What the run read and wrote so far: the counts a run that stops part-way is closed with. */
    readonly progress: SyncRunCounts;
}

export interface ConnectorPullOptions {
    /** Name of the `mapping` whose source (`connectorSource` or `datasourceSource`) is pulled. */
    mapping: string;
    /** Execution context the target read and the writes run under — the caller's (a `job`'s, built from its `organization`). */
    context?: any;
    environmentId?: string;
    /**
     * [ADR-0150 D3, #32071] The package the caller belongs to
     * (`ConnectorSourcePullRequest.callerPackageId`): for a job's pull, the
     * package that declares the job. The mapping is read from it. Absent,
     * `null` or `''`: read by no package.
     */
    callerPackageId?: string | null;
    /** Automation context handed to the connector action, as a flow node would hand it. */
    automation?: AutomationContext;
}

/**
 * What one pull did: the connector arm here, or the datasource arm
 * ({@link DatasourcePullResult}, ADR-0153 D1), told apart by `source` — the
 * contract's `ConnectorSourcePullResult`, with the runner's full report.
 */
export type ConnectorPullResult = ConnectorSourcePullOutcome | DatasourcePullResult;

/** A connector source's pull: one action call. */
export interface ConnectorSourcePullOutcome {
    source: 'connector';
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

type PulledMapping = MappingArtifactLike & { connectorSource?: ConnectorSourceLike; datasourceSource?: unknown };

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
 * [ADR-0150 D3, #32071] The refusal a by-name read threw, or `undefined` for
 * any other failure. Recognised by class and, as the runtime's `/meta` door
 * recognises it (`isPackageScopedRefusal`), by shape: `code ===
 * 'RESOURCE_CONFLICT'` with a `refusal` whose `status` is `'refused'`, which
 * is what reaches the pull when the error crossed a realm or a second copy of
 * `@objectstack/core` and `instanceof` cannot see it. The answer is the
 * error's own code, status and sentence.
 */
function packageScopedRefusalOf(err: unknown): { code: string; status: number; message: string } | undefined {
    if (err instanceof PackageScopedNameRefusedError) return { code: err.code, status: err.status, message: err.message };
    const thrown = err as {
        code?: unknown; status?: unknown; httpStatus?: unknown; message?: unknown;
        refusal?: { status?: unknown; message?: unknown };
    } | null | undefined;
    if (thrown?.code !== 'RESOURCE_CONFLICT' || thrown.refusal?.status !== 'refused') return undefined;
    const status = typeof thrown.status === 'number' ? thrown.status
        : typeof thrown.httpStatus === 'number' ? thrown.httpStatus : 409;
    const message = typeof thrown.message === 'string' && thrown.message ? thrown.message : String(thrown.refusal.message ?? '');
    return { code: thrown.code, status, message };
}

/**
 * Pull one `mapping`'s `connectorSource` and write what it returns. Throws
 * {@link ConnectorPullError} on every refusal, before anything is written.
 *
 * Every failed pull also logs ONE `warn` line naming the mapping and the
 * reason, then rethrows unchanged. A scheduled pull's caller is the job
 * runner, whose only record is the failed job run's `error`; without this
 * line a binding that can never pull failed on every tick and nothing in the
 * process log said so. `warn`, not `error`: nothing was written, so nothing
 * claims to be persisted that is not (AGENTS.md, degradation log levels), and
 * the caller still receives the failure.
 */
export async function pullConnectorSource(
    deps: ConnectorPullDeps,
    opts: ConnectorPullOptions,
): Promise<ConnectorPullResult> {
    let run: SyncRunHandle;
    let result: ConnectorPullResult;
    try {
        run = await openSyncRun(deps, opts);
    } catch (err) {
        logPullFailed(deps.logger, opts.mapping, err, undefined);
        throw err;
    }
    try {
        result = await pullOnce(deps, opts, run);
    } catch (err) {
        logPullFailed(deps.logger, opts.mapping, err, run);
        await closeFailedRun(deps, run, err);
        throw err;
    }
    const status = Number(result.summary?.errors ?? 0) > 0 ? 'degraded' : 'completed';
    const counts = countsOf(result);
    if (deps.runs && run.id) {
        try {
            await deps.runs.close(run.id, { status, counts });
        } catch (closeErr) {
            // The rows and the committed position are right; only the record of
            // how the run ended is not, so the pull still answers.
            deps.logger.error(
                `[Automation] the run record of mapping "${opts.mapping}" (${SYNC_RUN_OBJECT} ${run.id}) could not be closed `
                + `${status}: the row reads running, and the next boot closes it as interrupted although the pull ended. `
                + "Its rows and committed read position are right. Check that the data engine can write the table; the store's "
                + "own failure is in this record's meta.",
                undefined,
                { mapping: opts.mapping, syncRunId: run.id, cause: closeErr instanceof Error ? closeErr.name : typeof closeErr },
            );
        }
    }
    const committed = result.source === 'datasource' ? result.watermark.committed : undefined;
    deps.logger.info(
        `[Automation] pull of mapping "${opts.mapping}" ${status}: read ${counts.read}, created ${counts.created}, `
        + `updated ${counts.updated}, refused ${counts.refused}`
        + (committed !== undefined ? `; read position committed at ${String(committed)}` : '')
        + (run.id ? ` (${SYNC_RUN_OBJECT} ${run.id})` : ''),
        { mapping: opts.mapping, status, ...counts, ...(run.id ? { syncRunId: run.id } : {}) },
    );
    return result;
}

/** The run counts of a pull that ended: what it read, and the import runner's tallies. */
function countsOf(result: ConnectorPullResult): SyncRunCounts {
    const s = result.summary;
    return {
        read: Number(result.pulled ?? 0),
        created: Number(s?.created ?? 0),
        updated: Number(s?.updated ?? 0),
        refused: Number(s?.errors ?? 0),
    };
}

/** The one line a refused or stopped pull ends with, counts included. */
function logPullFailed(logger: Logger, mapping: string, err: unknown, run: SyncRunHandle | undefined): void {
    const reason = err instanceof ConnectorPullError ? err.reason : 'failed';
    const message = err instanceof Error ? err.message : String(err);
    const p = run?.progress;
    logger.warn(
        `[Automation] pull of mapping "${mapping}" failed (${reason}): ${message}`
        + (p ? ` — read ${p.read}, created ${p.created}, updated ${p.updated}, refused ${p.refused}` : '')
        + (run?.id ? ` (${SYNC_RUN_OBJECT} ${run.id})` : ''),
        { mapping, reason, ...(run?.id ? { syncRunId: run.id } : {}) },
    );
}

/** The organization a pull runs in: the job's, carried as the context's `tenantId`. */
function organizationOf(context: unknown): string | undefined {
    const tenantId = isPlainObject(context) ? context.tenantId : undefined;
    return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}

/** [ADR-0153 D7] The package a package-scoped read resolved the mapping to, or none (the environment's own, or the platform's). */
function packageOfHolder(holder: PackageScopedHolder): string | undefined {
    return holder.kind === 'package' ? holder.packageId : undefined;
}

/**
 * [ADR-0153 D7] The package a no-package mapping read served the item from:
 * the answer's `packageId` (the resolved item's `_packageId`), when it names a
 * package. A row rehydrated from `sys_metadata` carries that table's name
 * there, and an item the compatibility API registered carries
 * {@link RUNTIME_COMPATIBILITY_PACKAGE_ID}: neither is a package, as core's
 * package-scoped resolution reads them, so neither keys a read position.
 */
function servedHolderPackage(answer: Record<string, unknown> | undefined): string | undefined {
    const id = answer?.packageId;
    if (typeof id !== 'string' || id === '' || id === SystemObjectName.METADATA || id === RUNTIME_COMPATIBILITY_PACKAGE_ID) {
        return undefined;
    }
    return id;
}

/**
 * Open the pull's run (ADR-0153 D7). A ledger that cannot write the row
 * refuses the pull here, before anything is read.
 */
async function openSyncRun(deps: ConnectorPullDeps, opts: ConnectorPullOptions): Promise<SyncRunHandle> {
    const requested: SyncRunScope = { mapping: opts.mapping, organizationId: organizationOf(opts.context) };
    const progress: SyncRunCounts = { read: 0, created: 0, updated: 0, refused: 0 };
    const ledger = deps.runs;
    let targetObject: string | undefined;
    if (!ledger) {
        return {
            id: undefined, scope: requested, progress,
            get targetObject() { return targetObject; },
            identify: (identity) => {
                if (identity.mappingPackage) requested.mappingPackage = identity.mappingPackage;
                targetObject = identity.targetObject;
            },
            describe: async () => {},
            lastCommitted: async () => undefined,
            commit: async () => {},
        };
    }
    let id: string;
    let scope: SyncRunScope;
    try {
        const opened = await ledger.open(requested, new Date());
        id = opened.id;
        // The run is scoped by the organization its row holds, not the one asked for.
        scope = { mapping: opts.mapping, ...(opened.organizationId ? { organizationId: opened.organizationId } : {}) };
    } catch {
        // The engine's own message may name the row it was handed.
        throw new ConnectorPullError(
            { code: 'SERVICE_UNAVAILABLE', status: 503, reason: 'run_record_unavailable', mapping: opts.mapping },
            `Mapping "${opts.mapping}": the run record (${SYNC_RUN_OBJECT}) could not be written, so the pull did not start: `
            + 'its read position could not be stored either. Nothing was read. Check that schema sync ran for '
            + `${SYNC_RUN_OBJECT}; the server log has the store's own failure.`,
        );
    }
    // Every later ledger call that fails stops the pull with the same reason,
    // never with the store's own message; the sentence says what was read.
    const unavailable = (what: string, after: string): ConnectorPullError => new ConnectorPullError(
        { code: 'SERVICE_UNAVAILABLE', status: 503, reason: 'run_record_unavailable', mapping: opts.mapping },
        `Mapping "${opts.mapping}": ${what} (${SYNC_RUN_OBJECT} ${id}). ${after} The server log has the store's own failure.`,
    );
    const nothingRead = 'Nothing was read.';
    return {
        id, scope, progress,
        get targetObject() { return targetObject; },
        identify: (identity) => {
            if (identity.mappingPackage) scope.mappingPackage = identity.mappingPackage;
            targetObject = identity.targetObject;
        },
        describe: async (d) => {
            try {
                await ledger.describe(id, {
                    ...d,
                    ...(scope.mappingPackage ? { mappingPackage: scope.mappingPackage } : {}),
                    ...(targetObject !== undefined ? { targetObject } : {}),
                });
            } catch {
                throw unavailable('the run record could not say what the pull reads, so the pull did not start', nothingRead);
            }
        },
        lastCommitted: async () => {
            try {
                return await ledger.lastCommitted(scope);
            } catch {
                throw unavailable('the read position the last run committed could not be read, so the pull did not start', nothingRead);
            }
        },
        commit: async (position) => {
            try {
                await ledger.commit(id, scope, position);
            } catch {
                throw unavailable(
                    `the read position ${String(position)} reached at a window's end could not be stored, so the pull stopped there`,
                    'The windows finished before stay written, and the next run reads again from the last position stored.',
                );
            }
        },
    };
}

/**
 * Close a run whose pull threw: `failed`, with the refusal's reason and
 * sentence. Any other error is not the platform's own text (a driver's or an
 * upstream's may name rows or hosts), so the record keeps only its code and
 * points at the log. A close that cannot be written leaves the row `running`
 * until the next boot closes it as interrupted: said once, at `error`.
 */
async function closeFailedRun(deps: ConnectorPullDeps, run: SyncRunHandle, err: unknown): Promise<void> {
    if (!deps.runs || !run.id) return;
    const refusal = err instanceof ConnectorPullError ? err : undefined;
    const code = typeof (err as { code?: unknown } | null)?.code === 'string' ? (err as { code: string }).code : undefined;
    try {
        await deps.runs.close(run.id, {
            status: 'failed',
            counts: run.progress,
            failureReason: refusal ? refusal.reason : 'failed',
            failure: refusal
                ? refusal.message
                : `The pull stopped on an error that is not the platform's own${code && /^[A-Z][A-Z0-9_]*$/.test(code) ? ` (${code})` : ''}; `
                    + 'the server log of this run has it. Rows written before it stay written.',
        });
    } catch (closeErr) {
        deps.logger.error(
            `[Automation] the run record of mapping "${run.scope.mapping}" (${SYNC_RUN_OBJECT} ${run.id}) could not be closed after `
            + 'its pull failed: the row reads running, and stays so until the next boot closes it as interrupted. Its committed '
            + "read position is unaffected. Check that the data engine can write the table; the store's own failure is in this "
            + "record's meta.",
            undefined,
            { mapping: run.scope.mapping, syncRunId: run.id, cause: closeErr instanceof Error ? closeErr.name : typeof closeErr },
        );
    }
}

async function pullOnce(
    deps: ConnectorPullDeps,
    opts: ConnectorPullOptions,
    run: SyncRunHandle,
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

    // 1. The mapping.
    //
    // [ADR-0150 D3, #32071] `mapping` is addressed by `(package, name)`.
    //
    // - A caller of a package (`callerPackageId`, which the job binder sets to
    //   the package that declares the job) reads from that package: its own
    //   mapping, else the one holder in its declared closure plus `sys`. A
    //   name held twice in that reach, or held only outside it, is refused
    //   naming every candidate.
    // - A caller with no package reads as the import door reads a
    //   `mappingName`: the environment's own mapping, else the one package
    //   holder; a name two packages hold is refused naming both.
    //
    // A refusal fails the pull with its own code, status and sentence — ⛔
    // never as "no mapping is registered", and never by pulling through
    // whichever package's mapping came first.
    const callerPackageId = typeof opts.callerPackageId === 'string' && opts.callerPackageId !== ''
        ? opts.callerPackageId
        : undefined;
    let artifact: PulledMapping | undefined;
    // [ADR-0153 D7] The package that holds the mapping, as this read resolved
    // it: the run's read position is kept per holder, beside the name.
    let holderPackage: string | undefined;
    const byPackage = callerPackageId !== undefined ? deps.mappingByPackage?.(mappingName, callerPackageId) : undefined;
    if (byPackage !== undefined) {
        if (byPackage.status === 'refused') {
            const refused = new PackageScopedNameRefusedError(byPackage);
            return refuse(refused.code, refused.status, 'mapping_name_refused', `Mapping "${mappingName}": ${refused.message}`);
        }
        if (byPackage.status === 'resolved') {
            artifact = byPackage.item as PulledMapping;
            holderPackage = packageOfHolder(byPackage.holder);
        }
    } else {
        try {
            const res = await protocol.getMetaItem({ type: 'mapping', name: mappingName }) as Record<string, unknown> | undefined;
            artifact = res?.item as PulledMapping | undefined;
            holderPackage = servedHolderPackage(res);
        } catch (err) {
            const refused = packageScopedRefusalOf(err);
            if (refused) {
                return refuse(refused.code, refused.status, 'mapping_name_refused', `Mapping "${mappingName}": ${refused.message}`);
            }
            /* anything else is treated as not found below */
        }
    }
    if (!isPlainObject(artifact) || !Array.isArray(artifact.fieldMapping) || typeof artifact.targetObject !== 'string') {
        return refuse('MAPPING_NOT_FOUND', 404, 'mapping_not_found', `No mapping artifact named "${mappingName}" is registered`);
    }
    run.identify({ ...(holderPackage ? { mappingPackage: holderPackage } : {}), targetObject: artifact.targetObject });
    // [ADR-0153 D1] A datasource source is the other way in: a federated
    // object read in windows (`./datasource-pull.ts`). The mapping's schema
    // refuses carrying both sources, so whichever it carries is the one read.
    if (isPlainObject(artifact.datasourceSource)) {
        return pullDatasourceSource(deps, opts, artifact as PulledMapping & { datasourceSource: Record<string, unknown> }, run);
    }
    const source = artifact.connectorSource;
    if (!isPlainObject(source) || typeof source.connector !== 'string' || typeof source.action !== 'string') {
        return refuse(
            'VALIDATION_ERROR', 400, 'no_connector_source',
            `Mapping "${mappingName}" declares no source, so there is nothing to pull; add `
            + '`connectorSource: { connector, action }` naming a rest or openapi connector, or '
            + '`datasourceSource: { object, watermark: { field, start } }` naming the federated object it copies',
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
    let watermark: ConnectorSourcePullOutcome['watermark'];
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
    // [#28040] The input about to be sent — the watermark included — is judged
    // against the action's declared `inputSchema` by the check the
    // `connector_action` node runs (#27995), so a pull missing a required
    // parameter is refused here instead of reaching the remote API. The cast
    // hint is the pull door's own: `connectorSource.input` is JSON spread as
    // written and the watermark is the stored value, so no CEL envelope runs
    // here and the node's `int()` / `double()` / `bool()` advice cannot apply.
    const verdict = judgeConnectorInput(findConnectorActionInputSchema(registry, connector, action), input);
    if (verdict) {
        return refuse(
            'VALIDATION_ERROR', 400, 'input_schema_mismatch',
            `Mapping "${mappingName}": input for '${connector}.${action}' does not match the action's inputSchema — `
            + `${verdict.violations}. Nothing was pulled. Fix connectorSource.input so it satisfies the inputSchema `
            + 'GET /api/v1/automation/connectors lists for this action.'
            + (verdict.textForScalar
                ? ' A text value for an integer, number or boolean parameter is not converted: write it in '
                    + "connectorSource.input as a JSON number or boolean (50, not '50'); a watermark parameter "
                    + "carries the stored target field's value, so its declared type must be that field's."
                : ''),
        );
    }
    // [ADR-0153 D7] The run record says where it reads. A connector source
    // keeps no position of its own there: its starting point is still read
    // from the target (W1).
    const sentFrom = watermark?.from instanceof Date ? watermark.from.toISOString()
        : typeof watermark?.from === 'string' || typeof watermark?.from === 'number' ? watermark.from : undefined;
    await run.describe({
        sourceKind: 'connector',
        source: connector,
        ...(watermark ? { watermarkField: watermark.target } : {}),
        ...(sentFrom !== undefined ? { from: sentFrom } : {}),
    });
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
        // [#31810] Never create a record whose match key is blank: a source that
        // stopped sending the key field would otherwise re-create every changed
        // record with an empty key on each pull. The runner skips such a row;
        // the pull then counts it as an error (below).
        skipBlankMatchKey: true,
    });
    const refused = refuseBlankMatchKeys(summary, mappingName, matchFields);
    run.progress.read = records.length;
    run.progress.created = refused.summary.created;
    run.progress.updated = refused.summary.updated;
    run.progress.refused = refused.summary.errors;
    if (refused.count > 0) {
        logger.warn(
            `[Automation] connector pull: mapping "${mappingName}" — ${refused.count} pulled record(s) carry no value for `
            + `upsertKey ${matchFields.join(' + ')} and were not written; check that ${connector}.${action} still sends `
            + 'the field fieldMapping copies onto it',
        );
    }

    return {
        source: 'connector',
        mapping: mappingName,
        targetObject: objectName,
        connector,
        action,
        ...(watermark ? { watermark } : {}),
        pulled: records.length,
        summary: refused.summary,
    };
}

/**
 * [#31810] A pulled record whose match key is blank is a row ERROR on a pull,
 * not the import door's quiet skip: an uploaded file is read by the person who
 * chose `skipBlankMatchKey`, while a pull runs unattended, and its run outcome
 * is read from `errors` alone (a skip leaves the run `completed`). So each
 * `BLANK_MATCH_KEY` skip the runner reports is rewritten as a failed row, and
 * the tallies move with it. The import door's own blank-key behaviour is
 * untouched — this is the pull's reading of the runner's report.
 */
export function refuseBlankMatchKeys(
    summary: ImportRunSummary,
    mappingName: string,
    matchFields: string[],
): { summary: ImportRunSummary; count: number } {
    let count = 0;
    const results = summary.results.map((r) => {
        if (r.action !== 'skipped' || r.code !== 'BLANK_MATCH_KEY') return r;
        count++;
        // The runner's row, its `row` and its code kept: the verdict is the
        // runner's, only its reading (skip → failure) is the pull's.
        return {
            ...r,
            ok: false,
            action: 'failed' as const,
            error: `Mapping "${mappingName}": the pulled record has no value for upsertKey ${matchFields.join(' + ')}, `
                + 'so it was not written — a pull never creates a record it cannot match again',
        };
    });
    if (count === 0) return { summary, count };
    return {
        summary: { ...summary, results, skipped: summary.skipped - count, errors: summary.errors + count },
        count,
    };
}
