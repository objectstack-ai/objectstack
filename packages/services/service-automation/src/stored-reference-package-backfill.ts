// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R8, R9 and R11, D10] The automation service's stored
 * references to a flow or a connector instance gain the package that holds
 * it, beside its name — backfilled at boot.
 *
 * | Row | Table . name column | Gains | Rows asked |
 * |:--|:--|:--|:--|
 * | R8 | `sys_automation_run.flow_name` | `flow_package` | `paused` rows: a paused run resumes by it; terminal history rows are not backfilled (a new one is written with its package, #31696) |
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
 * whole registry — for a flow through {@link AutomationEngine.flowHolder}, for
 * a connector through {@link connectorNameResolver}. An environment override
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
 * (#31696) does, for R8: a paused run is stored with the package of the flow
 * it runs, and so is a terminal history row, and a resume of a name two
 * packages hold reads the row's package. The credential channel (R9) still
 * reads and writes by name, so a credential of a name two packages hold is
 * neither read nor written; the flow child's next part moves it onto the
 * column. A null left by this backfill still reads by name. The connection
 * store (R11) still reads by name, until the connector child moves it. S4's
 * upgrade report reads the columns too. No unique key changes.
 *
 * ## Re-runnable
 *
 * It reads only rows whose package column is null and writes only that
 * column, so a second run binds nothing and reports the same ambiguous and
 * unheld names. A row that names a package is never read as a candidate, so a
 * run can only add a package, never move one.
 */

import { describePackageScopedHolder, type PackageScopedResolution } from '@objectstack/objectql';
import { keysetWalk } from '@objectstack/types';

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
    /** The rows asked, beyond "the package column is null" (R8: paused runs only). */
    readonly where?: Record<string, unknown>;
}

/** The three stored references this service owns (ADR-0150 D8 rows R8, R9, R11). */
export const STORED_AUTOMATION_REFERENCES: readonly StoredReference[] = Object.freeze([
    {
        row: 'R8',
        type: 'flow',
        object: 'sys_automation_run',
        nameColumn: 'flow_name',
        packageColumn: 'flow_package',
        where: { status: 'paused' },
    },
    { row: 'R9', type: 'flow', object: 'sys_flow_credential', nameColumn: 'flow_name', packageColumn: 'flow_package' },
    { row: 'R11', type: 'connector', object: 'sys_connector_connection', nameColumn: 'connector_name', packageColumn: 'connector_package' },
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
    const answers = new Map<string, StoredReferenceHolder>();
    const { object, nameColumn, packageColumn, type } = reference;
    const unbound = { [packageColumn]: null };

    const walk = keysetWalk<Row>(
        async (query) => {
            const page = await engine.find(object, { ...query, fields: ['id', nameColumn, packageColumn], context: SYSTEM_CTX });
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
                    if (!options?.dryRun) {
                        await engine.update(object, { id, [packageColumn]: holder.packageId }, { context: SYSTEM_CTX });
                    }
                    const packageId = holder.packageId;
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
    };
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
}
