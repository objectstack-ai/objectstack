// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R10, D10] A dispatch key in `sys_flow_dispatch` names the
 * flow it was claimed for; its key gains that flow's package.
 *
 * The key IS the row's primary `id`, and the triggers build it
 * (`@objectstack/trigger-schedule`): a flow one package holds is keyed
 *
 *     schedule:PACKAGE:FLOW:WINDOW_START
 *     time-relative:PACKAGE:FLOW:SCOPE:RECORD_ID
 *
 * and any other flow keeps the bare shape it had,
 * `schedule:FLOW:WINDOW_START` / `time-relative:FLOW:SCOPE:RECORD_ID`. A flow
 * name is snake_case, so it never starts with a digit or a sign; a window
 * start and a scope start with the window's date, so they always do. That is
 * what tells the bare shape from the scoped one ({@link bareDispatchKeyFlow}),
 * and the two shapes never collide. The package-less shape is one primary key
 * per window, so it stays one row per window with no partial index.
 *
 * ## The re-key (this module)
 *
 * The rows claimed before the change, inside the ledger's retention, are
 * re-keyed at boot: each bare-shape row whose flow one package holds gains a
 * copy under the scoped key, with the same `dispatched_at`, `outcome` and
 * `settled_at`. The bare row is left where it is: the ledger never deletes
 * (the platform Reaper owns deletion, by the object's retention), and the
 * triggers' transition read treats it as the same window's claim until it
 * ages out. A second run finds every copy present and writes nothing.
 *
 * WHICH flow a key names is D4 identity, so the package is the flow's one
 * holder, from {@link AutomationEngine.flowHolder} (the one D3 rule, asked
 * with no caller): an environment override of P's flow keys as P. ⛔ Not
 * `armedFlowPackage`, a caller's answer. A name two packages hold keeps the
 * bare key and is reported naming every candidate; an environment-authored
 * flow and a name nothing holds keep the bare key and are reported.
 *
 * ## Ordering
 *
 * The automation plugin holds the ledger's claim, settle and read
 * ({@link ObjectStoreFlowDispatchStore.holdUntil}) until this run has
 * finished, so the triggers' first claim after an upgrade reads the re-keyed
 * rows.
 */

import { keysetWalk } from '@objectstack/types';
import type { StoredReferenceHolder } from './stored-reference-package-backfill.js';

/** The ledger table. */
const TABLE = 'sys_flow_dispatch';

/** Infrastructure rows, written and read the way the store does. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** The ledger's retention (`sys-flow-dispatch.object.ts`, `retention.maxAge: '30d'`). */
export const FLOW_DISPATCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The two key prefixes the triggers write. */
const PREFIXES = ['schedule:', 'time-relative:'] as const;

/**
 * A bare-shape key, split: its prefix, the flow it names and the rest. A flow
 * name is snake_case; the rest of a bare key starts with a date (a digit, or a
 * sign for a year outside 0–9999). Anything else — a scoped key, a key of
 * another shape — answers `undefined`.
 */
export function bareDispatchKeyFlow(key: string): { prefix: string; flow: string; rest: string } | undefined {
    for (const prefix of PREFIXES) {
        if (!key.startsWith(prefix)) continue;
        const match = /^([a-z_][a-z0-9_]*):([0-9+-].*)$/s.exec(key.slice(prefix.length));
        return match ? { prefix, flow: match[1], rest: match[2] } : undefined;
    }
    return undefined;
}

/** The scoped key a bare-shape key becomes for `packageId` (module doc). */
export function scopedDispatchKey(bare: { prefix: string; flow: string; rest: string }, packageId: string): string {
    return `${bare.prefix}${packageId}:${bare.flow}:${bare.rest}`;
}

/** The engine slice the re-key reads and writes through. */
export interface FlowDispatchRekeyEngine {
    find(object: string, options?: unknown): Promise<unknown>;
    insert(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** A flow name and how many keys carry it. */
export interface KeyedFlow {
    readonly flow: string;
    readonly rows: number;
}

/** What one run did. */
export interface FlowDispatchRekeyReport {
    /** Flows whose bare keys now have a scoped copy (written this run). */
    readonly rekeyed: ReadonlyArray<KeyedFlow & { readonly packageId: string }>;
    /** Flows whose bare keys already had their scoped copy: nothing written. */
    readonly present: ReadonlyArray<KeyedFlow & { readonly packageId: string }>;
    /** Flows two or more holders hold: the bare key stays, every candidate named. */
    readonly ambiguous: ReadonlyArray<KeyedFlow & { readonly candidates: readonly string[] }>;
    /** Flows the environment or the platform holds, or nothing holds: the bare key stays. */
    readonly unpackaged: readonly KeyedFlow[];
}

type Row = Record<string, unknown>;

const tally = <T extends KeyedFlow>(into: Map<string, T>, flow: string, make: () => T): void => {
    const at = into.get(flow);
    into.set(flow, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

const exists = async (engine: FlowDispatchRekeyEngine, id: string): Promise<boolean> => {
    const rows = await engine.find(TABLE, { where: { id }, limit: 1, fields: ['id'], context: SYSTEM_CTX });
    return Array.isArray(rows) && rows.length > 0;
};

/**
 * Give every bare-shape key inside retention whose flow one package holds its
 * scoped copy (module doc). Never moves or deletes a row; re-runnable.
 */
export async function rekeyFlowDispatchesByPackage(
    engine: FlowDispatchRekeyEngine,
    holderOf: (flow: string) => StoredReferenceHolder,
    now: Date = new Date(),
): Promise<FlowDispatchRekeyReport> {
    const rekeyed = new Map<string, KeyedFlow & { packageId: string }>();
    const present = new Map<string, KeyedFlow & { packageId: string }>();
    const ambiguous = new Map<string, KeyedFlow & { candidates: readonly string[] }>();
    const unpackaged = new Map<string, KeyedFlow>();
    const holders = new Map<string, StoredReferenceHolder>();
    const since = new Date(now.getTime() - FLOW_DISPATCH_RETENTION_MS).toISOString();

    const walk = keysetWalk<Row>(
        async (query) => {
            const page = await engine.find(TABLE, {
                ...query,
                fields: ['id', 'dispatched_at', 'outcome', 'settled_at', 'created_at'],
                context: SYSTEM_CTX,
            });
            return Array.isArray(page) ? (page as Row[]) : [];
        },
        { where: { created_at: { $gte: since } }, pageSize: PAGE_SIZE },
    );
    for await (const page of walk.pages()) {
        for (const row of page) {
            if (typeof row.id !== 'string') continue;
            const bare = bareDispatchKeyFlow(row.id);
            if (!bare) continue;
            let holder = holders.get(bare.flow);
            if (holder === undefined) {
                holder = holderOf(bare.flow);
                holders.set(bare.flow, holder);
            }
            if (holder.kind === 'ambiguous') {
                const candidates = holder.candidates;
                tally(ambiguous, bare.flow, () => ({ flow: bare.flow, rows: 0, candidates }));
                continue;
            }
            if (holder.kind !== 'package') {
                tally(unpackaged, bare.flow, () => ({ flow: bare.flow, rows: 0 }));
                continue;
            }
            const owner = holder.packageId;
            const scoped = scopedDispatchKey(bare, owner);
            if (await exists(engine, scoped)) {
                tally(present, bare.flow, () => ({ flow: bare.flow, rows: 0, packageId: owner }));
                continue;
            }
            try {
                await engine.insert(
                    TABLE,
                    {
                        id: scoped,
                        dispatched_at: row.dispatched_at ?? null,
                        created_at: row.created_at ?? null,
                        ...(row.outcome != null ? { outcome: row.outcome } : {}),
                        ...(row.settled_at != null ? { settled_at: row.settled_at } : {}),
                    },
                    { context: SYSTEM_CTX },
                );
            } catch (err) {
                // A concurrent claim (or another replica's re-key) may have
                // taken the scoped key first: that IS the copy this run wanted.
                if (await exists(engine, scoped)) {
                    tally(present, bare.flow, () => ({ flow: bare.flow, rows: 0, packageId: owner }));
                    continue;
                }
                throw err;
            }
            tally(rekeyed, bare.flow, () => ({ flow: bare.flow, rows: 0, packageId: owner }));
        }
    }
    return {
        rekeyed: [...rekeyed.values()],
        present: [...present.values()],
        ambiguous: [...ambiguous.values()],
        unpackaged: [...unpackaged.values()],
    };
}

/** The logger slice a run writes to. */
export interface FlowDispatchRekeyLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
}

const rowsOf = (n: number): string => `${n} key${n === 1 ? '' : 's'}`;

/** What a run says: the re-keyed flows, and the flows whose keys stay bare. */
export function logFlowDispatchRekey(report: FlowDispatchRekeyReport, logger: FlowDispatchRekeyLogger): void {
    if (report.rekeyed.length > 0) {
        logger.info(
            '[automation] sys_flow_dispatch: dispatch keys now name the package that holds their flow (ADR-0150 D8) — ' +
                report.rekeyed.map((r) => `'${r.flow}' → ${r.packageId} (${rowsOf(r.rows)})`).join(', ') + '.',
        );
    }
    if (report.ambiguous.length > 0) {
        logger.warn(
            '[automation] sys_flow_dispatch: more than one holder holds these flows, so none is picked and their dispatch ' +
                'keys keep the bare shape — ' +
                report.ambiguous.map((a) => `'${a.flow}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
            { ambiguous: report.ambiguous },
        );
    }
    if (report.unpackaged.length > 0) {
        logger.info(
            '[automation] sys_flow_dispatch: no package holds these flows, so their dispatch keys keep the bare shape — ' +
                report.unpackaged.map((u) => `'${u.flow}' (${rowsOf(u.rows)})`).join(', ') + '.',
            { unpackaged: report.unpackaged },
        );
    }
}
