// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D7] The `sys_sync_run` ledger (`./sys-sync-run.object.ts`): the
 * one writer of the run record every pull leaves, and the one reader of the
 * read position the next pull starts from.
 *
 * `pullConnectorSource` (`./connector-pull.ts`) opens a run before it reads
 * the mapping and closes it when the pull ends; the datasource pull
 * (`./datasource-pull.ts`) describes it, reads the last committed position
 * through it and commits through it at each window's end (ADR-0153 D2,
 * invariant 8). The plugin closes the runs a stopped server left `running`
 * at its next boot ({@link closeInterruptedSyncRuns}).
 *
 * Every read and write runs under a system context: the record is written by
 * the engine, never by the job's user, and the organization is a column the
 * writer fills from the job's, not a filter the context adds.
 */

import type { Logger } from '@objectstack/spec/contracts';

export const SYNC_RUN_OBJECT = 'sys_sync_run';

/** The reason a run a stopped server left `running` is closed with. */
export const SYNC_RUN_INTERRUPTED = 'interrupted';

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** How a run ended. */
export type SyncRunStatus = 'completed' | 'degraded' | 'failed';

/** What a run reads, written once the mapping's source is known. */
export interface SyncRunDescription {
    sourceKind: 'connector' | 'datasource';
    /** The federated object, or the connector instance. */
    source?: string;
    datasource?: string;
    readPath?: 'builtin' | 'floored';
    watermarkField?: string;
    /** Where the read started, in the field's storage form. */
    from?: string | number;
    /** The package that holds the mapping, as the pull resolved it (ADR-0150 D3); absent for the environment's own. */
    mappingPackage?: string;
    /** The mapping's `targetObject`. */
    targetObject?: string;
}

export interface SyncRunCounts {
    read: number;
    created: number;
    updated: number;
    refused: number;
}

export interface SyncRunEnd {
    status: SyncRunStatus;
    counts: SyncRunCounts;
    failureReason?: string;
    failure?: string;
}

/** The read position the latest committed run of a mapping stored. */
export interface SyncRunPosition {
    runId: string;
    /** The source the position was read from (the federated object). */
    source?: string;
    watermarkField?: string;
    /** The target the run that committed it wrote. */
    targetObject?: string;
    /** The position in the field's storage form, as stored (text). */
    position: string;
}

/**
 * Which mapping, in which organization, a run belongs to. A mapping is
 * addressed by `(package, name)` (ADR-0150 D3), so two packages' mappings of
 * one name keep two read positions.
 */
export interface SyncRunScope {
    mapping: string;
    /**
     * The package that holds the mapping, once the pull has resolved it: the
     * holder, not the caller. Absent for a mapping the environment authored or
     * no package holds, and before the mapping is read.
     */
    mappingPackage?: string;
    /** The job's organization; absent for a pull in no organization. */
    organizationId?: string;
}

/** A run as {@link SyncRunLedger.open} wrote it. */
export interface SyncRunOpened {
    id: string;
    /**
     * The organization the row was STORED with, which every later read and
     * write of the run is scoped by: the engine may stamp one the writer did
     * not send (under `single`, the Default Organization, ADR-0131 D10), and a
     * scope re-derived from the job's context would then miss the row.
     */
    organizationId?: string;
}

/** The run record's store. {@link ObjectStoreSyncRunLedger} is the one implementation. */
export interface SyncRunLedger {
    /** Write a `running` row; answer its id and the organization it was stored with. */
    open(scope: SyncRunScope, startedAt: Date): Promise<SyncRunOpened>;
    /** Say what the run reads, once the mapping's source is known. */
    describe(runId: string, description: SyncRunDescription): Promise<void>;
    /** The position the latest committed run of `scope` stored, if any. */
    lastCommitted(scope: SyncRunScope): Promise<SyncRunPosition | undefined>;
    /**
     * Store the position the run reached at a window's end. The row also takes
     * the read position over from every run of the scope that committed
     * earlier, so retention keeps the run committed last.
     */
    commit(runId: string, scope: SyncRunScope, position: string | number): Promise<void>;
    /** End the run. */
    close(runId: string, end: SyncRunEnd): Promise<void>;
}

/** The engine surface the ledger needs: ObjectQL's `find` / `insert` / `update`. */
export interface SyncRunLedgerEngine {
    find(object: string, query?: any): Promise<any>;
    insert(object: string, data: any, options?: any): Promise<any>;
    update(object: string, data: any, options?: any): Promise<any>;
}

function rowsOf(found: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(found)) return found as Array<Record<string, unknown>>;
    const records = (found as { records?: unknown } | null)?.records;
    return Array.isArray(records) ? records as Array<Record<string, unknown>> : [];
}

/** How many rows a predicate update reports it changed; anything but a count reads as none. */
function affectedRows(result: unknown): number {
    const count = typeof result === 'number' ? result : Number((result as { count?: unknown } | null)?.count);
    return Number.isFinite(count) ? count : 0;
}

/** A run id, as the automation engine's run ids are spelled. */
function nextSyncRunId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    const rand = g.crypto?.randomUUID
        ? g.crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `sync_${rand}`;
}

/** The organization half of a run's `where`: the organization, or none. */
function organizationWhere(organizationId: string | undefined): Record<string, unknown> {
    return organizationId ? { organization_id: organizationId } : { organization_id: { $null: true } };
}

/** The runs of one mapping in one organization: its holder package, its name, the organization. */
function scopeWhere(scope: SyncRunScope): Record<string, unknown> {
    return {
        mapping: scope.mapping,
        mapping_package: scope.mappingPackage ? scope.mappingPackage : { $null: true },
        ...organizationWhere(scope.organizationId),
    };
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * The `sys_sync_run` ledger over the data engine. Holds no state of its own:
 * the engine is the record, so two replicas pulling one mapping read the
 * same position.
 */
export class ObjectStoreSyncRunLedger implements SyncRunLedger {
    constructor(private readonly engine: SyncRunLedgerEngine) {}

    async open(scope: SyncRunScope, startedAt: Date): Promise<SyncRunOpened> {
        const id = nextSyncRunId();
        await this.engine.insert(SYNC_RUN_OBJECT, {
            id,
            organization_id: scope.organizationId ?? null,
            mapping: scope.mapping,
            status: 'running',
            started_at: startedAt.toISOString(),
            read_count: 0,
            created_count: 0,
            updated_count: 0,
            refused_count: 0,
            holds_position: false,
        }, { context: SYSTEM_CONTEXT });
        // Read back the organization the row holds: the one the run is scoped by.
        const stored = rowsOf(await this.engine.find(SYNC_RUN_OBJECT, {
            where: { id }, fields: ['id', 'organization_id'], limit: 1, context: SYSTEM_CONTEXT,
        }))[0];
        if (!stored) throw new Error(`${SYNC_RUN_OBJECT}: the run row ${id} was not found after it was written`);
        const organizationId = text(stored.organization_id);
        return { id, ...(organizationId ? { organizationId } : {}) };
    }

    async describe(runId: string, d: SyncRunDescription): Promise<void> {
        await this.engine.update(SYNC_RUN_OBJECT, {
            source_kind: d.sourceKind,
            source: d.source ?? null,
            datasource: d.datasource ?? null,
            read_path: d.readPath ?? null,
            watermark_field: d.watermarkField ?? null,
            watermark_from: d.from === undefined ? null : String(d.from),
            mapping_package: d.mappingPackage ?? null,
            target_object: d.targetObject ?? null,
        }, { where: { id: runId }, context: SYSTEM_CONTEXT });
    }

    async lastCommitted(scope: SyncRunScope): Promise<SyncRunPosition | undefined> {
        const found = await this.engine.find(SYNC_RUN_OBJECT, {
            where: { ...scopeWhere(scope), watermark_committed: { $null: false } },
            orderBy: [{ field: 'committed_at', order: 'desc' }],
            limit: 1,
            fields: ['id', 'source', 'watermark_field', 'target_object', 'watermark_committed'],
            context: SYSTEM_CONTEXT,
        });
        const row = rowsOf(found)[0];
        const position = text(row?.watermark_committed);
        if (!row || position === undefined) return undefined;
        return {
            runId: String(row.id),
            source: text(row.source),
            watermarkField: text(row.watermark_field),
            targetObject: text(row.target_object),
            position,
        };
    }

    async commit(runId: string, scope: SyncRunScope, position: string | number): Promise<void> {
        const committedAt = new Date().toISOString();
        await this.engine.update(SYNC_RUN_OBJECT, {
            watermark_committed: String(position),
            committed_at: committedAt,
            holds_position: true,
        }, { where: { id: runId }, context: SYSTEM_CONTEXT });
        // This row holds the position first, then every run committed EARLIER
        // lets it go: between the two writes both are kept, never neither. Only
        // earlier ones: two runs of one mapping interleaving their commits each
        // clear the other only when it is older, so the run committed last
        // keeps the flag whatever order the four writes land in.
        await this.engine.update(SYNC_RUN_OBJECT, { holds_position: false }, {
            where: {
                ...scopeWhere(scope),
                holds_position: true,
                id: { $ne: runId },
                committed_at: { $lt: committedAt },
            },
            multi: true,
            context: SYSTEM_CONTEXT,
        });
    }

    async close(runId: string, end: SyncRunEnd): Promise<void> {
        await this.engine.update(SYNC_RUN_OBJECT, {
            status: end.status,
            ended_at: new Date().toISOString(),
            read_count: end.counts.read,
            created_count: end.counts.created,
            updated_count: end.counts.updated,
            refused_count: end.counts.refused,
            failure_reason: end.failureReason ?? null,
            failure: end.failure ?? null,
        }, { where: { id: runId }, context: SYSTEM_CONTEXT });
    }
}

/**
 * [ADR-0153 D7] Close every run a stopped server left `running`: `failed`,
 * with the reason {@link SYNC_RUN_INTERRUPTED}. Its committed position is
 * untouched, so the next pull starts from the last window it finished.
 *
 * Called once at the automation plugin's boot. A run still live on another
 * replica of a cluster is closed too: its own end rewrites the row when it
 * finishes, and the position it commits is read by when it was committed,
 * never by status, so the next pull's starting point is the same either way.
 * Answers how many runs were closed.
 */
export async function closeInterruptedSyncRuns(engine: SyncRunLedgerEngine, logger: Logger): Promise<number> {
    const result = await engine.update(SYNC_RUN_OBJECT, {
        status: 'failed',
        failure_reason: SYNC_RUN_INTERRUPTED,
        failure: 'The server stopped while this pull was running. Rows it wrote stay written, and the next pull '
            + 'starts from the position it committed at its last finished window.',
        ended_at: new Date().toISOString(),
    }, { where: { status: 'running' }, multi: true, context: SYSTEM_CONTEXT });
    const closed = affectedRows(result);
    if (closed > 0) {
        logger.info(`[Automation] ${closed} pull run(s) a stopped server left running were closed failed (interrupted) in ${SYNC_RUN_OBJECT}`);
    }
    return closed;
}
