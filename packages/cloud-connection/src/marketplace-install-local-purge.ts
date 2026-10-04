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

/** One planned delete, in parent-first (insert) order. */
interface PlannedDelete {
    object: string;
    id: string;
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
 * Delete the rows `datasets` seeded, in scope, through `engine`.
 *
 * Never throws for a per-record or per-object failure — each is counted into
 * `errors` and reported through `warn`, so one refused row does not strand the
 * rest of the purge.
 */
export async function purgeSeedRows(input: SamplePurgeInput): Promise<SamplePurgeOutcome> {
    const { engine, datasets, graph, organizationId, warn } = input;
    const outcome: SamplePurgeOutcome = { deleted: 0, skipped: 0, errors: 0 };

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
    const planned: PlannedDelete[] = [];
    const plannedIds = new Map<string, Set<string>>(); // object → row ids already planned

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
                outcome.errors += ds.records.length;
                warn(`purge ${object}: the dataset's externalId does not parse (${err?.message ?? err}) — ${ds.records.length} seed record(s) not purged`);
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
                outcome.errors += ds.records.length;
                warn(`purge ${object}: reading its rows failed (${err?.message ?? err}) — ${ds.records.length} seed record(s) not purged`);
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
                    outcome.errors++;
                    warn(`purge ${object}: ${unidentifiable}, so no row is identifiable as its — not purged`);
                    continue;
                }
                // The parent seed row is gone, so no row in scope can carry a
                // key built from its id.
                if (parentAbsent) { outcome.skipped++; continue; }

                const ids = rowsByKey.get(keyOf(parts)) ?? [];
                if (ids.length === 0) { outcome.skipped++; continue; }
                if (ids.length > 1) {
                    outcome.errors++;
                    warn(`purge ${object}: ${ids.length} rows in scope carry the seed key ${keyOf(parts)}; the seed's row cannot be told from a user-authored one, so none is deleted`);
                    continue;
                }
                const id = ids[0];
                if (keyFields.length === 1) matched.set(parts[0], id);
                // Two seed records naming the same key resolve to one row.
                const seen = plannedIds.get(object) ?? new Set<string>();
                plannedIds.set(object, seen);
                if (seen.has(id)) { outcome.skipped++; continue; }
                seen.add(id);
                planned.push({ object, id });
            }
        }
    }

    // Child before parent: the reverse of the loader's insert order.
    for (const { object, id } of planned.reverse()) {
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
