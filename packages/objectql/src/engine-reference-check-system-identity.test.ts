// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12166 — the SHAPE of the pre-delete reference check's identity, at the
 * engine face. Maintainer ruling 2026-08-26, option A.
 *
 * The end-to-end contract — "empty referencing table + no read grant on it +
 * full delete rights on the target ⇒ the delete succeeds", and its converse —
 * is pinned against the REAL security middleware in
 * `packages/plugins/plugin-security/src/delete-reference-cleanup-system-identity.test.ts`,
 * because only that package has the gate whose 403 was the defect. This file
 * pins what that one structurally cannot see: WHICH context object each
 * operation of the delete path carries.
 *
 * Two facts, and they are the pair — either alone is satisfiable by a wrong
 * implementation:
 *
 *   1. the reference CHECK is elevated, and elevated `sudo()`-SHAPED — a bare
 *      `{ isSystem: true }` would also pass a test that only asked "is
 *      isSystem set?", while silently dropping the caller's TENANT scope and
 *      leaving the probe reading across the tenant wall;
 *   2. nothing else does (ruling constraint 1) — the `set_null` UPDATE and the
 *      `cascade` DELETE still run as the caller.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

const acct = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
/** Optional lookup → resolved behaviour `set_null`: the cleanup WRITE path. */
const note = {
    name: 'note',
    label: 'Note',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        account: { name: 'account', type: 'lookup' as const, reference: 'acct' },
    },
};
/** Explicit cascade → the recursive DELETE path. */
const task = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', deleteBehavior: 'cascade' },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            if ((row[k] ?? null) !== ((v as any) ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id);
            if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

/** The caller: a real principal, with a tenant and a timezone to lose. */
const CALLER = () => ({
    userId: 'u_operator',
    tenantId: 'org-77',
    timezone: 'Asia/Shanghai',
    positions: ['p_line'],
    permissions: [],
} as any);

describe('#12166 — the reference check is elevated, sudo()-shaped', () => {
    let engine: ObjectQL;
    let seen: Array<{ operation: string; object: string; context: any }>;

    beforeEach(async () => {
        engine = new ObjectQL({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [acct, note, task]) engine.registry.registerObject(o as any);
        seen = [];
        engine.registerMiddleware(async (ctx: any, next: any) => {
            seen.push({ operation: ctx.operation, object: ctx.object, context: ctx.context });
            await next();
        });
    });

    const probeOf = (object: string) =>
        seen.find((s) => s.operation === 'find' && s.object === object)?.context;

    it('the dependents probe carries isSystem — AND keeps the caller\'s tenant, user and timezone', async () => {
        const a = await engine.insert('acct', { name: 'Acme' }, { context: { isSystem: true } } as any);
        await engine.delete('acct', { where: { id: a.id }, context: CALLER() } as any);

        const probe = probeOf('note');
        expect(probe).toBeDefined();

        // The elevation…
        expect(probe.isSystem).toBe(true);
        // …and the three things a BARE `{ isSystem: true }` would have dropped.
        // `tenantId` is the load-bearing one: without it this probe reads across
        // the tenant wall, which is a WIDER change than the card authorises —
        // and a test asserting only `isSystem` would not notice.
        expect(probe.tenantId).toBe('org-77');
        expect(probe.userId).toBe('u_operator');
        expect(probe.timezone).toBe('Asia/Shanghai');
    });

    it('the caller\'s own context object is not mutated — the elevation is a derivative', async () => {
        const caller = CALLER();
        const a = await engine.insert('acct', { name: 'Acme' }, { context: { isSystem: true } } as any);
        await engine.delete('acct', { where: { id: a.id }, context: caller } as any);

        // A `context.isSystem = true` assignment instead of a spread would
        // elevate the CALLER for the rest of the request — every later write in
        // the same transaction included. That is the silent version of this
        // card's defect with the sign flipped.
        expect(caller.isSystem).toBeUndefined();
    });
});

describe('#12166 constraint 1 — nothing ELSE on the delete path changes identity', () => {
    let engine: ObjectQL;
    let seen: Array<{ operation: string; object: string; context: any }>;

    beforeEach(async () => {
        engine = new ObjectQL({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [acct, note, task]) engine.registry.registerObject(o as any);
        seen = [];
        engine.registerMiddleware(async (ctx: any, next: any) => {
            seen.push({ operation: ctx.operation, object: ctx.object, context: ctx.context });
            await next();
        });
    });

    it('the set_null cleanup WRITE still runs as the caller', async () => {
        const a = await engine.insert('acct', { name: 'Acme' }, { context: { isSystem: true } } as any);
        await engine.insert('note', { account: a.id }, { context: { isSystem: true } } as any);
        seen = [];

        await engine.delete('acct', { where: { id: a.id }, context: CALLER() } as any);

        const write = seen.find((s) => s.operation === 'update' && s.object === 'note');
        expect(write).toBeDefined();
        // NOT elevated. The caller's authority over the dependent rows is
        // untouched by this card — only the CHECK was relaxed.
        expect(write!.context.isSystem).toBeFalsy();
        expect(write!.context.userId).toBe('u_operator');
        // The #3023 integrity marker still rides it, unchanged.
        expect(write!.context.__referentialFieldClear).toBe(true);
    });

    it('the cascade DELETE of a child still runs as the caller', async () => {
        const a = await engine.insert('acct', { name: 'Acme' }, { context: { isSystem: true } } as any);
        await engine.insert('task', { account: a.id }, { context: { isSystem: true } } as any);
        seen = [];

        await engine.delete('acct', { where: { id: a.id }, context: CALLER() } as any);

        const childDelete = seen.find((s) => s.operation === 'delete' && s.object === 'task');
        expect(childDelete).toBeDefined();
        expect(childDelete!.context.isSystem).toBeFalsy();
        expect(childDelete!.context.userId).toBe('u_operator');
    });

    it('the target\'s OWN delete still runs as the caller', async () => {
        const a = await engine.insert('acct', { name: 'Acme' }, { context: { isSystem: true } } as any);
        seen = [];

        await engine.delete('acct', { where: { id: a.id }, context: CALLER() } as any);

        const own = seen.find((s) => s.operation === 'delete' && s.object === 'acct');
        expect(own).toBeDefined();
        // The whole point of the ruling's first constraint: the caller's own
        // delete authorisation is exactly as it was. If this ever reads
        // `isSystem`, the card has become a privilege escalation.
        expect(own!.context.isSystem).toBeFalsy();
        expect(own!.context.userId).toBe('u_operator');
    });
});
