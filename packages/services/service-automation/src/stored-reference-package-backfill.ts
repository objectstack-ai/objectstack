// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R8, R9 and R11, D10] The automation service's stored
 * references to a flow or a connector instance gain the package that holds
 * it, beside its name — backfilled at boot.
 *
 * | Row | Table . name column | Gains | Rows asked |
 * |:--|:--|:--|:--|
 * | R8 | `sys_automation_run.flow_name` | `flow_package` | every row, paused and terminal: a paused run resumes by it, and a history row reads as its package's run once a second package holds the name (#31696) |
 * | R9 | `sys_flow_credential.flow_name` | `flow_package` | every row |
 * | R11 | `sys_connector_connection.connector_name` | `connector_package` | every row |
 *
 * Flows and connectors are behavioural metadata (ADR-0150 D1 bucket 2),
 * identified by `(package, name)`, so each reference gains a second column:
 * two facts, two columns (ADR-0126 §4), ⛔ never a re-encoded literal.
 *
 * ## Where the answer comes from
 *
 * The row records WHICH item it belongs to (D4 identity), so the answer is
 * the one holder of the name in this environment when the backfill runs:
 * objectql's `resolvePackageScopedName` (ADR-0150 D3, the one rule every
 * reader of the epic shares), asked as a caller with no package, over the
 * whole registry — for a flow through {@link AutomationEngine.durableFlowHolder},
 * for a connector through {@link connectorNameResolver} — over every holder, a
 * disabled package's included (#32183): the binding is written once, and a
 * disable is reversible. An environment override
 * of P's flow is the overlay of P's item, not a second one (D4), so its rows
 * bind to P. ⛔ Not {@link AutomationEngine.armedFlowPackage}: that answers
 * the package a reference written IN the armed body resolves from, a caller's
 * question. ⛔ No second rule, no walk of its own, no first-registered
 * fallback:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own item, or the platform's (a connector
 *    a plugin registers in code) → stays null, which is its spelling;
 *  - refused → the ambiguous set: left null, and every candidate named;
 *  - not-found → nothing holds the name any more: left null, and named.
 *
 * ## What it does not change
 *
 * Nothing here moves a reader or a writer onto the columns. The flow child
 * (#31696) does, for R8 and R9: a paused run is stored with the package of the
 * flow it runs, and so is a terminal history row; a credential is written
 * with its flow's one holder; and a resume or a credential read of a name two
 * packages hold reads the row's package (a row with none answers only while
 * one package holds the name). A null left by this backfill still reads by
 * name. The connection store (R11) still reads by name, until the connector
 * child moves it. S4's upgrade report reads the columns too. R11's column is a
 * part of its table's unique key (#31699), so a bind there can meet a unique
 * violation (below); no other reference's key carries its column.
 *
 * ## Re-runnable
 *
 * It reads only rows whose package column is null and writes only that
 * column, so a second run binds nothing and reports the same ambiguous and
 * unheld names. A row that names a package is never read as a candidate, so a
 * run can only add a package, never move one.
 *
 * [#31699] A bind the database refuses as a unique violation — the row would be
 * a second row of one key, a connection beside another of the same organization
 * and instance that already names the holder (R11's key is `(organization_id,
 * connector_package, connector_name)`) — is reported by id (`duplicated`, at
 * `warn`) and the row is left naming no package; the walk goes on, so one such
 * row never stops every later row from being bound, nor every later boot. The
 * plugin-security grant backfill's rule (#32164). Any other failed write still
 * ends the run. A dry run asks the key's own question of each row it would bind
 * (`identityColumns`), and reports a row the write would refuse as
 * `duplicated`, not `bound`.
 */

import { describePackageScopedHolder, type PackageScopedResolution } from '@objectstack/objectql';
import { isUniqueViolationError, keysetWalk } from '@objectstack/types';

/** The declared type a stored reference names. */
export type StoredReferenceType = 'flow' | 'connector';

/** One stored reference to a flow or a connector instance (ADR-0150 D8). */
export interface StoredReference {
    /** The ADR-0150 D8 row. */
    readonly row: 'R8' | 'R9' | 'R11';
    /** The declared type the name is of. */
    readonly type: StoredReferenceType;
    /** The table. */
    readonly object: string;
    /** The column naming the item. */
    readonly nameColumn: string;
    /** The column this backfill fills. */
    readonly packageColumn: string;
    /** The rows asked, beyond "the package column is null" (none of the three narrows it). */
    readonly where?: Record<string, unknown>;
    /**
     * [#31699] The columns beside the name and the package that make up the
     * table's unique key, when it carries the package (R11: the organization).
     * A dry run asks that key of each row it would bind; absent, a bind cannot
     * collide with another row.
     */
    readonly identityColumns?: readonly string[];
}

/** The three stored references this service owns (ADR-0150 D8 rows R8, R9, R11). */
export const STORED_AUTOMATION_REFERENCES: readonly StoredReference[] = Object.freeze([
    {
        row: 'R8',
        type: 'flow',
        object: 'sys_automation_run',
        nameColumn: 'flow_name',
        packageColumn: 'flow_package',
    },
    { row: 'R9', type: 'flow', object: 'sys_flow_credential', nameColumn: 'flow_name', packageColumn: 'flow_package' },
    {
        row: 'R11',
        type: 'connector',
        object: 'sys_connector_connection',
        nameColumn: 'connector_name',
        packageColumn: 'connector_package',
        identityColumns: ['organization_id'],
    },
]);

/** Infrastructure rows, written and read the way the service's other boot passes do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** Who holds a referenced name, as the backfill reads the rule's answer. */
export type StoredReferenceHolder =
    | { readonly kind: 'package'; readonly packageId: string }
    | { readonly kind: 'environment' }
    | { readonly kind: 'platform' }
    | { readonly kind: 'unheld' }
    | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

/**
 * The rule's answer, as the backfill reads it (module doc). `undefined` — no
 * registry to ask — is `unheld`: nothing is bound on an answer nobody gave.
 */
export function storedReferenceHolderOf(answer: PackageScopedResolution | undefined): StoredReferenceHolder {
    switch (answer?.status) {
        case 'resolved':
            return answer.holder.kind === 'package'
                ? { kind: 'package', packageId: answer.holder.packageId }
                : { kind: answer.holder.kind };
        case 'refused':
            return { kind: 'ambiguous', candidates: answer.candidates.map(describePackageScopedHolder) };
        default:
            return { kind: 'unheld' };
    }
}

/** A name and how many rows carry it. */
export interface ReferencedName {
    readonly name: string;
    readonly rows: number;
}

/** What one run did for one reference, or would do in a dry run. */
export interface StoredReferenceBackfillReport {
    readonly row: StoredReference['row'];
    readonly object: string;
    readonly packageColumn: string;
    /** Names whose rows now carry the one package holder (written, or to be written in a dry run). */
    readonly bound: ReadonlyArray<ReferencedName & { readonly packageId: string }>;
    /** Names two or more holders hold: left null, every candidate named. */
    readonly ambiguous: ReadonlyArray<ReferencedName & { readonly candidates: readonly string[] }>;
    /** Names nothing holds: left null. */
    readonly unheld: readonly ReferencedName[];
    /** Names the environment's own item, or the platform's, answers: left null, its spelling. */
    readonly unpackaged: ReadonlyArray<ReferencedName & { readonly holder: 'environment' | 'platform' }>;
    /**
     * [#31699] Rows the bind would make a second row of one key (another row of
     * the same key already names the holder): the write was refused as a
     * unique violation, the row is left naming no package, and the walk goes
     * on. Each is named by id, so an operator can review the pair.
     */
    readonly duplicated: ReadonlyArray<{ readonly id: string; readonly name: string; readonly packageId: string }>;
}

/** The engine slice the backfill reads and writes through. */
export interface StoredReferenceBackfillEngine {
    find(object: string, options?: unknown): Promise<unknown>;
    update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** Options for {@link backfillStoredReferencePackages}. */
export interface StoredReferenceBackfillOptions {
    /** Report what would be bound and write nothing. */
    readonly dryRun?: boolean;
}

type Row = Record<string, unknown>;

const tally = <T extends ReferencedName>(into: Map<string, T>, name: string, make: () => T): void => {
    const at = into.get(name);
    into.set(name, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/**
 * Bind every asked row of `reference` whose package column is null to the one
 * package that holds its name (module doc). Reads by keyset page; writes only
 * the package column, one row at a time, by id.
 */
export async function backfillStoredReferencePackages(
    engine: StoredReferenceBackfillEngine,
    reference: StoredReference,
    holderOf: (type: StoredReferenceType, name: string) => StoredReferenceHolder,
    options?: StoredReferenceBackfillOptions,
): Promise<StoredReferenceBackfillReport> {
    const bound = new Map<string, ReferencedName & { packageId: string }>();
    const ambiguous = new Map<string, ReferencedName & { candidates: readonly string[] }>();
    const unheld = new Map<string, ReferencedName>();
    const unpackaged = new Map<string, ReferencedName & { holder: 'environment' | 'platform' }>();
    const duplicated: Array<{ id: string; name: string; packageId: string }> = [];
    const answers = new Map<string, StoredReferenceHolder>();
    const { object, nameColumn, packageColumn, type } = reference;
    const identityColumns = reference.identityColumns ?? [];
    const unbound = { [packageColumn]: null };
    const dryBound = new Set<string>();

    const walk = keysetWalk<Row>(
        async (query) => {
            const page = await engine.find(object, {
                ...query,
                fields: ['id', nameColumn, packageColumn, ...identityColumns],
                context: SYSTEM_CTX,
            });
            return Array.isArray(page) ? (page as Row[]) : [];
        },
        { where: reference.where ? { $and: [unbound, reference.where] } : unbound, pageSize: PAGE_SIZE },
    );
    for await (const page of walk.pages()) {
        for (const row of page) {
            // Only a row with no package is a candidate; the filter is the driver's,
            // and this re-check keeps a driver that reads it loosely from moving one.
            if (row[packageColumn] !== null && row[packageColumn] !== undefined) continue;
            const id = row.id;
            const name = row[nameColumn];
            if (id === null || id === undefined || typeof name !== 'string' || name === '') continue;
            let holder = answers.get(name);
            if (!holder) {
                holder = holderOf(type, name);
                answers.set(name, holder);
            }
            switch (holder.kind) {
                case 'package': {
                    const packageId = holder.packageId;
                    if (options?.dryRun) {
                        // A dry run writes nothing, so it also counts the keys it has
                        // already bound in this pass: two unbound rows of one key bind
                        // once, and the second is a second row, as the real run finds.
                        const key = keyOf(identityColumns, row, name, packageId);
                        if ((key !== undefined && dryBound.has(key)) || (await wouldBeSecondRow(engine, reference, row, name, packageId))) {
                            duplicated.push({ id: String(id), name, packageId });
                            break;
                        }
                        if (key !== undefined) dryBound.add(key);
                    } else {
                        try {
                            await engine.update(object, { id, [packageColumn]: packageId }, { context: SYSTEM_CTX });
                        } catch (e: unknown) {
                            // [#31699] One row whose bind is a unique violation is reported
                            // and left as it stands; the walk goes on (`duplicated`). Only
                            // where the key carries the package, and only once a read
                            // confirms the row that already names the holder: anything
                            // else still ends this reference's pass.
                            if (!isUniqueViolationError(e) || !(await wouldBeSecondRow(engine, reference, row, name, packageId))) throw e;
                            duplicated.push({ id: String(id), name, packageId });
                            break;
                        }
                    }
                    tally(bound, name, () => ({ name, rows: 0, packageId }));
                    break;
                }
                case 'ambiguous': {
                    const candidates = holder.candidates;
                    tally(ambiguous, name, () => ({ name, rows: 0, candidates }));
                    break;
                }
                case 'unheld':
                    tally(unheld, name, () => ({ name, rows: 0 }));
                    break;
                default: {
                    const kind = holder.kind;
                    tally(unpackaged, name, () => ({ name, rows: 0, holder: kind }));
                }
            }
        }
    }
    return {
        row: reference.row,
        object,
        packageColumn,
        bound: [...bound.values()],
        ambiguous: [...ambiguous.values()],
        unheld: [...unheld.values()],
        unpackaged: [...unpackaged.values()],
        duplicated,
    };
}

/**
 * [#31699] The unique key `row` would take once bound to `packageId`, or
 * `undefined` when the reference's key does not carry the package or a key
 * part is NULL (a NULL key part collides with nothing).
 */
function keyOf(identityColumns: readonly string[], row: Row, name: string, packageId: string): string | undefined {
    if (identityColumns.length === 0) return undefined;
    const parts: unknown[] = [];
    for (const column of identityColumns) {
        const value = row[column];
        if (value === null || value === undefined) return undefined;
        parts.push(value);
    }
    return JSON.stringify([...parts, name, packageId]);
}

/**
 * [#31699] Would binding `row` to `packageId` make it a second row of the
 * table's unique key? Asked by a dry run, and by a real run to confirm a
 * unique violation before reporting it, only of a reference whose
 * key carries the package (`identityColumns`): one read of the row that already
 * names the holder under the same key.
 */
async function wouldBeSecondRow(
    engine: StoredReferenceBackfillEngine,
    reference: StoredReference,
    row: Row,
    name: string,
    packageId: string,
): Promise<boolean> {
    const identityColumns = reference.identityColumns ?? [];
    if (identityColumns.length === 0) return false;
    const where: Record<string, unknown> = { [reference.nameColumn]: name, [reference.packageColumn]: packageId };
    for (const column of identityColumns) {
        const value = row[column];
        // A NULL key part collides with nothing under a UNIQUE index.
        if (value === null || value === undefined) return false;
        where[column] = value;
    }
    const found = await engine.find(reference.object, { where, fields: ['id'], limit: 1, context: SYSTEM_CTX });
    return Array.isArray(found) && found.length > 0;
}

/** The logger slice a run writes to. */
export interface StoredReferenceBackfillLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
}

const rowsOf = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;

/**
 * Run the backfill once for this boot, for each reference whose table this
 * composition carries, and say what it did (module doc). Never fatal: a table
 * that cannot be read or written keeps its rows as they were — the state every
 * reader already handles — and the next boot tries again.
 *
 * The caller runs it once the registry's bare-name holders are sealed
 * (`kernel:bootstrapped`): before that, a package of this boot could still
 * register and change who holds a name, and binding then would record an
 * answer the boot can still contradict.
 */
export async function backfillStoredReferencePackagesAtBoot(
    engine: StoredReferenceBackfillEngine,
    carries: (object: string) => boolean,
    holderOf: (type: StoredReferenceType, name: string) => StoredReferenceHolder,
    logger: StoredReferenceBackfillLogger,
): Promise<StoredReferenceBackfillReport[]> {
    const reports: StoredReferenceBackfillReport[] = [];
    for (const reference of STORED_AUTOMATION_REFERENCES) {
        if (!carries(reference.object)) continue;
        let report: StoredReferenceBackfillReport;
        try {
            report = await backfillStoredReferencePackages(engine, reference, holderOf);
        } catch (e: unknown) {
            logger.warn(
                `[automation] the ${reference.object}.${reference.packageColumn} backfill did not finish: rows that name no package ` +
                    'keep naming none, every reader still reads the name as before, and the next boot tries again.',
                { error: e instanceof Error ? e.message : String(e) },
            );
            continue;
        }
        reports.push(report);
        logStoredReferenceBackfill(report, logger);
    }
    return reports;
}

/** What a run says (module doc): bound and unheld at `info`, the ambiguous set at `warn`. */
export function logStoredReferenceBackfill(report: StoredReferenceBackfillReport, logger: StoredReferenceBackfillLogger): void {
    const at = `${report.object}.${report.packageColumn}`;
    if (report.bound.length > 0) {
        logger.info(
            `[automation] ${at}: rows now name the package that holds the item they name (ADR-0150 D8) — ` +
                report.bound.map((b) => `'${b.name}' → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
        );
    }
    if (report.ambiguous.length > 0) {
        logger.warn(
            `[automation] ${at}: more than one holder holds these names, so none is picked and each row is left naming no ` +
                'package. Every reader still reads the name as before — ' +
                report.ambiguous.map((a) => `'${a.name}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
            { ambiguous: report.ambiguous },
        );
    }
    if (report.unheld.length > 0) {
        logger.info(
            `[automation] ${at}: nothing holds these names, so their rows name no package — ` +
                report.unheld.map((u) => `'${u.name}' (${rowsOf(u.rows)})`).join(', ') + '.',
            { unheld: report.unheld },
        );
    }
    if (report.duplicated.length > 0) {
        logger.warn(
            `[automation] ${at}: binding these rows would make each a second row of one key — another row of the same key ` +
                'already names the holder — so each is left naming no package. Review the pair and delete the row that ' +
                'should not stand — ' +
                report.duplicated.map((d) => `'${d.name}' row ${d.id} → ${d.packageId}`).join(', ') + '.',
            { duplicated: report.duplicated },
        );
    }
}
