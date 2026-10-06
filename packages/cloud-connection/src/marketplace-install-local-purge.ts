// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The purge half of install-local sample data: find the rows an installed
 * package's seed datasets put in the database, and delete them THROUGH THE
 * ENGINE.
 *
 * ## What a seed row is — the loader's identity, not a second one
 *
 * `SeedLoaderService` upserts each seed record by its dataset's `externalId`
 * (one field, or a composite list), and the spec declares the default when a
 * dataset names none (`SeedSchema.shape.externalId`). Seed records carry no
 * `id` as a rule: the CRM example's 28 records key by `name`, `email` and
 * `subject` and declare no id at all, so an id-keyed purge matched nothing.
 * This module keys the database rows the way the loader keys them for an
 * upsert, and a row is the seed's ONLY when its key equals a key a seed record
 * declares. A row whose key no seed record declares (a user-authored row,
 * including one in a seeded object) is never read as a seed row.
 *
 * Reference fields in a key (the composite key of a join table, framework#3434)
 * are stored as the PARENT ROW'S id, so the authored natural key is translated
 * through the rows this purge matched for the parent dataset — the same
 * in-memory resolution the loader uses for targets seeded in the same load.
 *
 * The identification is its own pass, {@link matchSeedRows}, and it only reads.
 * The purge deletes what it identifies; the install-local listing asks it
 * whether the caller's scope holds ANY seed row, and answers that as the
 * entry's `withSampleData` (#21775). So "is this package's sample data here?"
 * and "what would a purge delete?" are one answer, read one way.
 *
 * ## Scope — the install's own
 *
 * `organizationId` is the scope the install and the reseed wrote under, chosen
 * by the caller from the same two primitives (`organizationWallActive`,
 * `resolveActiveOrgId`): under an organization wall it is the caller's active
 * organization and every read below is filtered to it, exactly as
 * `loadExistingRecords` filters an org-pinned upsert; without a wall the
 * deployment is one logical tenant and the loader's upsert match is table-wide,
 * so this one is too.
 *
 * ## What it refuses to guess
 *
 * A seed record whose row cannot be identified is counted in `errors` with its
 * reason logged — never in `skipped`, which means only "no row in scope carries
 * this key" (deleted already, or never landed):
 *   - the record has no value for a key field, or the value is not a literal;
 *   - a key field references an object this package does not seed;
 *   - MORE THAN ONE row in scope carries the key — the seed's row and a
 *     user-authored one are then indistinguishable, so neither is deleted;
 *   - the engine refuses the delete (a hook, a restrict, a required parent).
 *
 * ## Order and context
 *
 * Deletes run child before parent: the REVERSE of the loader's own topological
 * insert order (`buildDependencyGraph`), never a hand-written per-object order.
 * Each delete is `engine.delete(object, { where: { id } })` under
 * `SEED_WRITE_EXECUTION_CONTEXT` — the posture the seed was written with:
 * record-change automation suppressed, lifecycle hooks (audit, sharing,
 * storage, the package's own) still run.
 */

import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { SeedSchema, type ObjectDependencyGraphParsed } from '@objectstack/spec/data';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';

/** A seed dataset as the install ledger holds it (the artifact's `data[]` entry). */
export interface PurgeSeedDataset {
    object: string;
    externalId?: unknown;
    records: ReadonlyArray<Record<string, unknown>>;
}

/** The per-record outcome counts the purge route answers with. */
export interface SamplePurgeOutcome {
    deleted: number;
    skipped: number;
    errors: number;
}

export interface SamplePurgeInput {
    engine: Pick<IObjectQLEngine, 'find' | 'delete'>;
    datasets: ReadonlyArray<PurgeSeedDataset>;
    /** The loader's dependency graph over the datasets' objects. */
    graph: Pick<ObjectDependencyGraphParsed, 'nodes' | 'insertOrder'>;
    /** The install's scope: set under an organization wall, absent otherwise. */
    organizationId?: string;
    /** Where a record that could not be purged is reported, with its reason. */
    warn: (message: string) => void;
}

/** A read under the posture the loader's upsert match reads with. */
const READ_CONTEXT = { isSystem: true } as const;

/** One row the matcher identified as a seed record's. */
export interface MatchedSeedRow {
    object: string;
    id: string;
}

/**
 * Why seed records could not be matched to a row, reported as data so each
 * caller words it for its own door:
 *   - `externalId`: the dataset's `externalId` does not parse (every record of it);
 *   - `read`: the dataset's rows in scope could not be read (every record of it);
 *   - `unidentifiable`: the record names no usable key (`detail` says why);
 *   - `ambiguous`: `rows` rows in scope carry the key `detail`.
 */
export interface SeedMatchProblem {
    object: string;
    kind: 'externalId' | 'read' | 'unidentifiable' | 'ambiguous';
    /** The seed records the problem covers. */
    records: number;
    detail: string;
    /** `ambiguous` only: how many rows in scope carry the key. */
    rows?: number;
}

/** What {@link matchSeedRows} found. */
export interface SeedRowMatch {
    /** The rows identified as the seed's, each once, in the loader's insert order (parents first). */
    rows: MatchedSeedRow[];
    /** Seed records no row in scope carries, or naming a row an earlier record already matched. */
    absent: number;
    /** Seed records no row could be identified for, each reported through `report`. */
    unidentified: number;
}

export interface SeedRowMatchInput {
    engine: Pick<IObjectQLEngine, 'find'>;
    datasets: ReadonlyArray<PurgeSeedDataset>;
    /** The loader's dependency graph over the datasets' objects. */
    graph: Pick<ObjectDependencyGraphParsed, 'nodes' | 'insertOrder'>;
    /** The scope: set under an organization wall, absent otherwise. */
    organizationId?: string;
    /** Where a record that could not be matched is reported. */
    report: (problem: SeedMatchProblem) => void;
    /**
     * Stop at the first identified row: for a caller asking only whether ANY
     * seed row is in scope. The counts are then partial; `rows` is empty
     * exactly when no seed row is in scope (or none could be identified).
     */
    firstOnly?: boolean;
}

/** `string | number | boolean` — the only key values a row can be matched on. */
function isLiteral(v: unknown): v is string | number | boolean {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** A collision-free map key for a list of key parts (no control byte involved). */
function keyOf(parts: readonly string[]): string {
    return JSON.stringify(parts);
}

/**
 * Identify, READ-ONLY, the rows in scope that `datasets` seeded: the identity
 * rules in this module's header, and nothing deleted. The purge deletes what
 * this returns; the install-local listing asks it whether the caller's scope
 * holds any seed row at all (`firstOnly`).
 *
 * Never throws for a per-record or per-object failure — each is counted into
 * `unidentified` and reported through `report`.
 */
export async function matchSeedRows(input: SeedRowMatchInput): Promise<SeedRowMatch> {
    const { engine, datasets, graph, organizationId, report, firstOnly } = input;
    const match: SeedRowMatch = { rows: [], absent: 0, unidentified: 0 };

    // Datasets per object, in the loader's insert order (parents first); an
    // object the graph did not order keeps its dataset order, after the rest.
    const byObject = new Map<string, PurgeSeedDataset[]>();
    for (const ds of datasets) {
        const list = byObject.get(ds.object) ?? [];
        list.push(ds);
        byObject.set(ds.object, list);
    }
    const order = [
        ...graph.insertOrder.filter((o) => byObject.has(o)),
        ...[...byObject.keys()].filter((o) => !graph.insertOrder.includes(o)),
    ];
    const referenceTargets = new Map<string, Map<string, string>>(); // object → field → target object
    for (const node of graph.nodes) {
        referenceTargets.set(node.object, new Map(node.references.map((r) => [r.field, r.targetObject])));
    }

    // Authored single-field key value → matched row id, per object: how a
    // reference inside a CHILD's key is translated to the id it stores.
    const matchedIdByKey = new Map<string, Map<string, string>>();
    const plannedIds = new Map<string, Set<string>>(); // object → row ids already matched

    for (const object of order) {
        const refs = referenceTargets.get(object) ?? new Map<string, string>();
        const matched = new Map<string, string>();
        matchedIdByKey.set(object, matched);

        for (const ds of byObject.get(object)!) {
            let keyFields: string[];
            try {
                const declared = SeedSchema.shape.externalId.parse(ds.externalId);
                keyFields = Array.isArray(declared) ? declared : [declared];
            } catch (err: any) {
                match.unidentified += ds.records.length;
                report({ object, kind: 'externalId', records: ds.records.length, detail: String(err?.message ?? err) });
                continue;
            }

            // The rows in scope, keyed exactly as the loader keys them.
            let rowsByKey: Map<string, string[]>;
            try {
                const rows = await engine.find(object, {
                    ...(organizationId ? { where: { organization_id: organizationId } } : {}),
                    fields: ['id', ...keyFields],
                    context: READ_CONTEXT,
                });
                rowsByKey = new Map();
                for (const row of rows) {
                    const parts: string[] = [];
                    for (const f of keyFields) {
                        const v = row?.[f];
                        if (v === undefined || v === null || v === '') break;
                        parts.push(String(v));
                    }
                    if (parts.length !== keyFields.length) continue;
                    const k = keyOf(parts);
                    rowsByKey.set(k, [...(rowsByKey.get(k) ?? []), String(row.id)]);
                }
            } catch (err: any) {
                match.unidentified += ds.records.length;
                report({ object, kind: 'read', records: ds.records.length, detail: String(err?.message ?? err) });
                continue;
            }

            for (const rec of ds.records) {
                const parts: string[] = [];
                let unidentifiable: string | undefined;
                let parentAbsent = false;
                for (const f of keyFields) {
                    const v = rec?.[f];
                    if (v === undefined || v === null || v === '') {
                        unidentifiable = `the seed record has no value for its key field '${f}'`;
                        break;
                    }
                    if (!isLiteral(v)) {
                        unidentifiable = `key field '${f}' is not a literal value`;
                        break;
                    }
                    const target = refs.get(f);
                    if (target === undefined) {
                        parts.push(String(v));
                        continue;
                    }
                    const targetMatches = matchedIdByKey.get(target);
                    if (!targetMatches) {
                        unidentifiable = `key field '${f}' references '${target}', which this package does not seed`;
                        break;
                    }
                    const parentId = targetMatches.get(String(v));
                    if (parentId === undefined) { parentAbsent = true; break; }
                    parts.push(parentId);
                }
                if (unidentifiable) {
                    match.unidentified++;
                    report({ object, kind: 'unidentifiable', records: 1, detail: unidentifiable });
                    continue;
                }
                // The parent seed row is gone, so no row in scope can carry a
                // key built from its id.
                if (parentAbsent) { match.absent++; continue; }

                const ids = rowsByKey.get(keyOf(parts)) ?? [];
                if (ids.length === 0) { match.absent++; continue; }
                if (ids.length > 1) {
                    match.unidentified++;
                    report({ object, kind: 'ambiguous', records: 1, detail: keyOf(parts), rows: ids.length });
                    continue;
                }
                const id = ids[0];
                if (keyFields.length === 1) matched.set(parts[0], id);
                // Two seed records naming the same key resolve to one row.
                const seen = plannedIds.get(object) ?? new Set<string>();
                plannedIds.set(object, seen);
                if (seen.has(id)) { match.absent++; continue; }
                seen.add(id);
                match.rows.push({ object, id });
                if (firstOnly) return match;
            }
        }
    }
    return match;
}

/** A matcher problem in the purge's own words (its log lines predate the matcher). */
function describePurgeProblem(p: SeedMatchProblem): string {
    switch (p.kind) {
        case 'externalId':
            return `purge ${p.object}: the dataset's externalId does not parse (${p.detail}) — ${p.records} seed record(s) not purged`;
        case 'read':
            return `purge ${p.object}: reading its rows failed (${p.detail}) — ${p.records} seed record(s) not purged`;
        case 'unidentifiable':
            return `purge ${p.object}: ${p.detail}, so no row is identifiable as its — not purged`;
        case 'ambiguous':
            return `purge ${p.object}: ${p.rows} rows in scope carry the seed key ${p.detail}; the seed's row cannot be told from a user-authored one, so none is deleted`;
    }
}

/**
 * Delete the rows `datasets` seeded, in scope, through `engine`: the rows
 * {@link matchSeedRows} identifies, child before parent.
 *
 * Never throws for a per-record or per-object failure — each is counted into
 * `errors` and reported through `warn`, so one refused row does not strand the
 * rest of the purge.
 */
export async function purgeSeedRows(input: SamplePurgeInput): Promise<SamplePurgeOutcome> {
    const { engine, datasets, graph, organizationId, warn } = input;
    const match = await matchSeedRows({
        engine,
        datasets,
        graph,
        organizationId,
        report: (problem) => warn(describePurgeProblem(problem)),
    });
    const outcome: SamplePurgeOutcome = { deleted: 0, skipped: match.absent, errors: match.unidentified };

    // Child before parent: the reverse of the loader's insert order.
    for (const { object, id } of [...match.rows].reverse()) {
        try {
            const result = await engine.delete(object, { where: { id }, context: SEED_WRITE_EXECUTION_CONTEXT });
            if (result === false || result === 0) outcome.skipped++;
            else outcome.deleted++;
        } catch (err: any) {
            outcome.errors++;
            warn(`purge ${object}#${id}: the engine refused the delete — ${err?.message ?? err}`);
        }
    }
    return outcome;
}
