// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23406] The save door's 409 for a refused FIRST-WRITE PIN states what the
 * caller asserted.
 *
 * A present `null` parent (`If-None-Match: *` on the REST door) asserts "no
 * current row of this lifecycle" (`SaveMetaItemRequestSchema.parentVersion` in
 * `@objectstack/spec`). When a row is there, the save is refused
 * `409 METADATA_CONFLICT` — and the sentence used to be every conflict's:
 * "… has been modified since you loaded it. Expected parent null but current is
 * …". That caller loaded nothing; it asserted that nothing was there. The
 * sentence now says so, and names the lifecycle, the pin and the current
 * version. The code, the status and the keyed attributes (`currentVersion`,
 * `actualHead`, `expectedParent`) are unchanged.
 *
 * Pinned on both lifecycles the pin can name — a first draft over a pending
 * draft, and a first write of the live row over an existing one — with the
 * control: a conflict that is NOT a first-write pin (a token naming no current
 * head) keeps its own sentence.
 *
 * The engine is an in-memory double of the stored tables with the repository's
 * own read and write shapes (`protocol.served-content-hash.test.ts`'s double,
 * cut to the verbs these saves reach: every write here is a first insert, and
 * every refusal lands before the repository would update a row).
 */

import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
    [k: string]: unknown;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        // Any other combinator is REFUSED, never read as a field name.
        if (k.startsWith('$')) throw new Error(`stub engine: combinator '${k}' is not implemented`);
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

function makeEngine() {
    const rows = new Map<string, Row>();
    const historyRows: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): Row | null => {
        if (w.id !== undefined) {
            for (const r of rows.values()) if (r.id === w.id) return r;
            return null;
        }
        if (w.package_id !== undefined) return rows.get(keyOf(w)) ?? null;
        for (const r of rows.values()) if (matchesWhere(r, w)) return r;
        return null;
    };
    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            return findRow(o.where);
        },
        async find(table: string, o: { where?: Record<string, unknown>; limit?: number } = {}) {
            const matched = table === 'sys_metadata_audit'
                ? auditRows.filter((a) => matchesWhere(a, o.where))
                : table === 'sys_metadata_history'
                    ? historyRows.filter((h) => matchesWhere(h, o.where))
                    : Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata_audit') {
                auditRows.push({ id: `a_${nextId}`, ...data });
                return { id: `a_${nextId}` };
            }
            if (table === 'sys_metadata_history') {
                historyRows.push({ id: `h_${nextId}`, ...data });
                return { id: `h_${nextId}` };
            }
            const row = { id: `r_${nextId}`, ...data } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: { registerItem: () => {}, registerObject: () => {}, getPackage: () => undefined },
    };
    return { engine, rows };
}

const viewBody = (label: string) => ({
    name: 'case_grid',
    type: 'grid',
    label,
    columns: ['id', 'title'],
    object: 'case',
    viewKind: 'list',
});
const ref = { type: 'view', name: 'case_grid', actor: 'admin' } as const;

async function rejection(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
    let resolved = false;
    try {
        await run();
        resolved = true;
    } catch (e) {
        caught = e;
    }
    expect(resolved, 'expected a refusal, but the call resolved').toBe(false);
    return caught;
}

/** The sentence of a refused first-write pin: the assertion and what contradicts it, never "since you loaded it". */
function expectAssertionSentence(message: string, lifecycle: 'draft' | 'active', current: string): void {
    expect(message).toContain('view/case_grid');
    expect(message).toContain(`no ${lifecycle} row exists`);
    expect(message).toContain('If-None-Match: *');
    expect(message).toContain(`current is ${current}`);
    expect(message).not.toContain('since you loaded it');
    expect(message).not.toContain('Expected parent');
}

describe('[#23406] a refused first-write pin is told what it asserted', () => {
    it('draft: a first draft over a pending draft — the sentence states the assertion; code, status and keyed fields unchanged', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const first: any = await p.saveMetaItem({ ...ref, item: viewBody('first'), parentVersion: null, mode: 'draft' } as any);

        const refused = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('second'), parentVersion: null, mode: 'draft' } as any));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'METADATA_CONFLICT', status: 409 });
        expect(refused.currentVersion).toBe(first.version);
        expect(refused.actualHead).toBe(first.version);
        expect(refused.expectedParent).toBeNull();
        expectAssertionSentence(String(refused.message), 'draft', first.version);
    });

    it('active: a first write of the live row over an existing one — the same, naming the active lifecycle', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const first: any = await p.saveMetaItem({ ...ref, item: viewBody('first'), parentVersion: null } as any);

        const refused = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('second'), parentVersion: null } as any));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'METADATA_CONFLICT', status: 409 });
        expect(refused.currentVersion).toBe(first.version);
        expect(refused.expectedParent).toBeNull();
        expectAssertionSentence(String(refused.message), 'active', first.version);
    });

    it('control: a conflict that is no first-write pin (a token naming no current head) keeps the door\'s own sentence', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const first: any = await p.saveMetaItem({ ...ref, item: viewBody('first'), mode: 'draft' } as any);

        const refused = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('stale'), parentVersion: 'hmac-sha256:stale', mode: 'draft' } as any));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'METADATA_CONFLICT', status: 409 });
        expect(refused.currentVersion).toBe(first.version);
        expect(String(refused.message).startsWith('view/case_grid has been modified since you loaded it.')).toBe(true);
        expect(String(refused.message)).not.toContain('If-None-Match');
    });
});
