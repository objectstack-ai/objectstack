// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22985] A publish whose object-storage sync is REFUSED is reported at
// `error`, once, with its consequence and its fix — and the publish is not
// failed.
//
// `ensureObjectStorage` runs after the publish has already been written and
// registered, so when the driver refuses its `syncObjectSchema` the publish
// still answers success and the object is served with no table behind it.
// From the outside nothing looks wrong, which is the class AGENTS.md
// "Degradation log levels" sends to `error`. The wording is not pinned: the
// pins hold the level, the count, the named object, the named remedy and the
// driver's refusal as its own argument — and the "looks healthy" half, as the
// publish verdict the caller reads.
//
// The stub engine is the one `protocol.publish-side-effects-canonical-type.test.ts`
// drives the same publish path with, plus a set of object names whose schema
// sync the driver refuses.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    recorded_at: string;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine(refused: ReadonlySet<string>) {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;
    /**
     * The observation channel this file is about: every name handed to the
     * driver's schema sync, in call order. `ensureObjectStorage` is the only
     * caller of it on a publish, so this doubles as "did Phase 2's DDL step
     * run, and under which spelling did it decide to".
     */
    const syncedObjects: string[] = [];

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => {
                    const w = opts.where;
                    if (w.type !== undefined && h.type !== w.type) return false;
                    if (w.name !== undefined && h.name !== w.name) return false;
                    if (w.version !== undefined && h.version !== w.version) return false;
                    if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
                    return true;
                }) ?? null;
            }
            if (table === 'sys_metadata_commit') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        syncObjectSchema: vi.fn(async (name: string) => {
            if (refused.has(name)) throw new Error(`there is already an index named ${name}`);
            syncedObjects.push(name);
            return true;
        }),
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return { engine, rows, syncedObjects };
}

function makeProtocol(refused: ReadonlySet<string> = new Set()) {
    const { engine, syncedObjects } = makeStubEngine(refused);
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod') as any;
    return { protocol, syncedObjects };
}

const PKG = 'app.demo';

/** An object body that clears the authoring gates the publish path runs first. */
const objectBody = (name: string) => ({
    name,
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** The fragment an operator greps for; the rest of the wording is not pinned. */
const HEADLINE = 'its storage was NOT created or altered';

afterEach(() => {
    vi.restoreAllMocks();
});

function spyConsole() {
    return {
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
}

async function publish(protocol: any, name: string) {
    await protocol.saveMetaItem({
        type: 'object', name, item: objectBody(name), packageId: PKG, mode: 'draft',
    });
    return protocol.publishMetaItem({ type: 'object', name });
}

describe('[#22985] a refused object-storage sync on publish is an error, once', () => {
    it('the publish still answers success, and exactly one error line names the object, the remedy and the refusal', async () => {
        const spy = spyConsole();
        const { protocol, syncedObjects } = makeProtocol(new Set(['ticket']));

        const res = await publish(protocol, 'ticket');

        // The half that makes it the durability class: the caller is told the
        // publish succeeded, while the storage it was published for is absent.
        expect(res.success).toBe(true);
        expect(syncedObjects).toEqual([]);

        const reports = spy.error.mock.calls.filter((args) => String(args[0]).includes(HEADLINE));
        expect(reports).toHaveLength(1);
        const [message, refusal] = reports[0];
        expect(message).toContain("object 'ticket'");
        // ② the fix, by its named subjects.
        expect(message).toContain('publish the object again');
        expect(message).toContain('restart');
        // One line: the first line carries both halves, and the driver's
        // refusal rides as its own argument rather than inside it.
        expect(message).not.toContain('\n');
        expect(message).not.toContain('there is already an index');
        expect(refusal).toBe('there is already an index named ticket');
        // …and it is not ALSO reported at a quieter level.
        expect(spy.warn.mock.calls.filter((args) => /table sync failed|ticket/.test(String(args[0])))).toEqual([]);
    });

    it('CONTROL: a publish whose sync succeeds reports nothing at error', async () => {
        const spy = spyConsole();
        const { protocol, syncedObjects } = makeProtocol();

        const res = await publish(protocol, 'ticket');

        expect(res.success).toBe(true);
        expect(syncedObjects).toEqual(['ticket']);
        expect(spy.error).not.toHaveBeenCalled();
    });
});
