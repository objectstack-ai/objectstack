// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31196] The cached by-name `/meta` read (`getMetaItemCached`) answers
 * `lastModified` — the REST door's `Last-Modified` — as the item's own last
 * change, never the time of the read.
 *
 *  1. Two reads of one unchanged stored item answer the same `lastModified`:
 *     the stored row's `updated_at`, the time of the save that wrote it.
 *  2. A save and a publish of that item each move it to their own time.
 *  3. An item no stored row serves (a code-shipped definition from the
 *     registry) has no known change time and answers no `lastModified` key.
 *  4. CONTROL: the ETag and `cacheControl` (`private, no-cache`) are as they
 *     were — freshness stays the ETag's.
 *
 * The clock is fake and moved between steps, so a read stamped with the
 * read time (the defect) differs from the save time by whole minutes, never
 * by a sub-second accident.
 *
 * Ablation (one-shot, recorded in the PR): putting
 * `lastModified: new Date().toISOString()` back in
 * `protocol-search-and-cache.ts` turns §1, §2 and §3 red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

type Row = Record<string, any>;

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function matches(r: Row, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (!whereValueMatches(r[k] ?? null, v)) return false;
    }
    return true;
}

/** A `sys_metadata` store; every other table answers empty. `code` is the registry's code-shipped items. */
function makeStubEngine(code: Record<string, Row> = {}) {
    const rows: Row[] = [];
    let nextId = 0;
    const engine: any = {
        async findOne(t: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, opts);
            if (t !== 'sys_metadata') return null;
            return rows.find((r) => matches(r, opts.where)) ?? null;
        },
        async find(t: string, opts?: { where?: Record<string, unknown> }) {
            if (t !== 'sys_metadata') return [];
            return rows.filter((r) => matches(r, opts?.where));
        },
        async count(t: string, opts?: { where?: Record<string, unknown> }) {
            if (t !== 'sys_metadata') return 0;
            return rows.filter((r) => matches(r, opts?.where)).length;
        },
        async insert(t: string, data: Row) {
            if (t !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...data };
            rows.push(row);
            return { id: row.id };
        },
        async update(t: string, data: Row, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (t !== 'sys_metadata') return { id: null };
            const found = rows.find((r) => matches(r, opts.where));
            if (!found) return { id: null };
            Object.assign(found, data);
            return { id: found.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: (type: string, name: string) => (type === 'object' ? code[name] : undefined),
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

/** A runtime-created business object (no artifact), so the save door writes a stored row. */
const authored = (name: string, label = 'Invoice') => ({
    name,
    label,
    sharingModel: 'private',
    fields: { amount: { type: 'currency', label: 'Amount' } },
});

const T_SAVE = '2026-11-07T08:00:00.000Z';
const T_READ_1 = '2026-11-07T08:05:00.000Z';
const T_READ_2 = '2026-11-07T08:09:00.000Z';
const T_RESAVE = '2026-11-07T09:00:00.000Z';
const T_DRAFT = '2026-11-07T10:00:00.000Z';
const T_PUBLISH = '2026-11-07T10:30:00.000Z';
const T_READ_3 = '2026-11-07T11:00:00.000Z';

describe('[#31196] the cached by-name read answers the item\'s own change time, never the read time', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('§1 two reads of one unchanged stored item answer the same lastModified — the save time', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        vi.setSystemTime(new Date(T_SAVE));
        await protocol.saveMetaItem({ type: 'object', name: 'invoice', item: authored('invoice') });

        vi.setSystemTime(new Date(T_READ_1));
        const first = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });
        vi.setSystemTime(new Date(T_READ_2));
        const second = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });

        expect(first.lastModified).toBe(T_SAVE);
        expect(second.lastModified).toBe(T_SAVE);
        // CONTROL (§4): the same document answers the same validator and the
        // same freshness rule as before.
        expect(second.etag).toEqual(first.etag);
        expect(first.cacheControl).toEqual({ directives: ['private', 'no-cache'] });
        expect(first.notModified).toBe(false);
    });

    it('§2 a save moves it, and so does a publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        vi.setSystemTime(new Date(T_SAVE));
        await protocol.saveMetaItem({ type: 'object', name: 'invoice', item: authored('invoice') });
        vi.setSystemTime(new Date(T_READ_1));
        const before = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });

        vi.setSystemTime(new Date(T_RESAVE));
        await protocol.saveMetaItem({ type: 'object', name: 'invoice', item: authored('invoice', 'Bill') });
        vi.setSystemTime(new Date(T_READ_2));
        const afterSave = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });

        vi.setSystemTime(new Date(T_DRAFT));
        await protocol.saveMetaItem({ type: 'object', name: 'invoice', item: authored('invoice', 'Receipt'), mode: 'draft' });
        // A pending draft is not the served item: the active row's time stands.
        const withDraft = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });
        vi.setSystemTime(new Date(T_PUBLISH));
        await protocol.publishMetaItem({ type: 'object', name: 'invoice' });
        vi.setSystemTime(new Date(T_READ_3));
        const afterPublish = await protocol.getMetaItemCached({ type: 'object', name: 'invoice' });

        expect(before.lastModified).toBe(T_SAVE);
        expect(afterSave.lastModified).toBe(T_RESAVE);
        expect(withDraft.lastModified).toBe(T_RESAVE);
        expect((afterPublish.data as { label?: string }).label).toBe('Receipt');
        expect(afterPublish.lastModified).toBe(T_PUBLISH);
        // CONTROL (§4): each change also moved the validator.
        expect(afterSave.etag).not.toEqual(before.etag);
        expect(afterPublish.etag).not.toEqual(afterSave.etag);
    });

    it('§3 an item no stored row serves has no known change time: no lastModified key', async () => {
        const { engine } = makeStubEngine({ shipped: { ...authored('shipped', 'Shipped'), _packageId: 'com.example.code' } });
        const protocol = new ObjectStackProtocolImplementation(engine);
        vi.setSystemTime(new Date(T_READ_1));
        const read = await protocol.getMetaItemCached({ type: 'object', name: 'shipped' });

        expect((read.data as { label?: string }).label).toBe('Shipped');
        expect(Object.keys(read)).not.toContain('lastModified');
        // CONTROL (§4): it still carries its validator and freshness rule.
        expect(read.etag?.value).toEqual(expect.any(String));
        expect(read.cacheControl).toEqual({ directives: ['private', 'no-cache'] });
    });

    it('§4 the change time stays off the by-name read\'s published envelope', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        vi.setSystemTime(new Date(T_SAVE));
        await protocol.saveMetaItem({ type: 'object', name: 'invoice', item: authored('invoice') });
        const envelope = await protocol.getMetaItem({ type: 'object', name: 'invoice' });

        expect(JSON.stringify(envelope)).not.toContain(T_SAVE);
        expect(Object.keys(envelope)).not.toContain('lastModified');
    });
});
