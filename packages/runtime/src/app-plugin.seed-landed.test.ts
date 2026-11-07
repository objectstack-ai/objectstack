// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import { SEED_SETTLEMENT_SERVICE, type ISeedSettlementService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { PluginContext } from '@objectstack/core';

/**
 * #23354 — AppPlugin publishes which rows its seed landed on.
 *
 * The seed-ownership claims hand to an owner only the unowned rows the SEED
 * wrote (ADR-0138 D1: a guest-written or public-form row keeps no owner), and
 * read which rows those are through the `seed-settlement` contract's
 * `seededRecordIds`. This file pins the producer half on both of AppPlugin's
 * seed paths:
 *
 *  - the inline boot seed publishes its rows BEFORE it settles, so the claim
 *    that runs inside `app:seeded` already reads them — on the loader path and
 *    on the basic-insert fallback alike;
 *  - the per-organization replayer records the rows each replay landed on,
 *    under that organization, for the owner bind that follows the
 *    organization's creation.
 */

/**
 * `where` as the seed loader spells it here: field equality only. A combinator
 * or a value operator is REFUSED rather than answered, so a shape this double
 * does not implement can never read as a match or a miss.
 */
function rowMatches(row: any, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`engine double: unsupported combinator ${k}`);
        if (v !== null && typeof v === 'object') {
            throw new Error(`engine double: unsupported value operator on ${k}: ${JSON.stringify(v)}`);
        }
        return (row[k] ?? null) === (v ?? null);
    });
}

/** A faithful in-memory engine: `where` filters, ids minted on insert. */
function createEngine() {
    const store: Record<string, any[]> = {};
    let next = 0;
    const engine: any = {
        store,
        async find(object: string, query?: any) {
            let rows = (store[object] ?? []).filter((r) => rowMatches(r, query?.where));
            if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
            return rows.map((r) => ({ ...r }));
        },
        async findOne(object: string, query?: any) {
            assertEngineFindOnePredicate(object, query);
            return (await engine.find(object, { ...query, limit: 1 }))[0] ?? null;
        },
        async insert(object: string, data: any) {
            const mint = (d: any) => ({ id: d.id ?? `gen_${++next}`, ...d });
            const rows = Array.isArray(data) ? data.map(mint) : [mint(data)];
            (store[object] ??= []).push(...rows);
            return Array.isArray(data) ? rows.map((r) => ({ ...r })) : { ...rows[0] };
        },
        async update(object: string, data: any, options?: any) {
            assertEngineUpdateDispatch(data, options);
            const row = (store[object] ?? []).find((r) => r.id === data.id);
            if (row) Object.assign(row, data);
            return row ? { ...row } : null;
        },
        async count(object: string, query?: any) {
            return (await engine.find(object, query)).length;
        },
        async aggregate() {
            return [];
        },
    };
    return engine;
}

const OBJECTS: Record<string, any> = {
    crm_case: { name: 'crm_case', fields: { name: { type: 'text' }, owner_id: { type: 'text' } } },
};

const metadataService = {
    getObject: vi.fn(async (name: string) => OBJECTS[name]),
    listObjects: vi.fn(async () => Object.values(OBJECTS)),
    get: vi.fn(async (_type: string, name: string) => OBJECTS[name]),
    list: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
};

const bundle = () => ({
    id: 'seed-landed-app',
    data: [
        {
            object: 'crm_case',
            externalId: 'name',
            records: [{ name: 'CASE-1' }, { name: 'CASE-2' }],
        },
    ],
});

describe('AppPlugin publishes the rows its seed landed on (#23354)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    beforeEach(() => {
        delete process.env.OS_MULTI_ORG_ENABLED;
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
    });
    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    /**
     * A context with a real service map. `trigger` records what a consumer
     * reading the contract INSIDE `app:seeded` would see at that moment.
     */
    function makeContext(engine: any, opts: { metadata: boolean }) {
        const services = new Map<string, unknown>();
        const seenAtSettle: Array<readonly string[]> = [];
        const read = () => services.get(SEED_SETTLEMENT_SERVICE) as ISeedSettlementService | undefined;
        const ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, svc: unknown) => {
                if (services.has(name)) throw new Error(`service '${name}' already registered`);
                services.set(name, svc);
            }),
            getService: vi.fn((name: string) => {
                if (name === 'objectql') return engine;
                if (name === 'metadata') return opts.metadata ? metadataService : undefined;
                return services.get(name);
            }),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger: vi.fn((event: string) => {
                if (event === 'app:seeded') seenAtSettle.push(read()?.seededRecordIds?.('crm_case') ?? []);
            }),
        } as unknown as PluginContext;
        return { ctx, services, seenAtSettle, read };
    }

    it('the loader path: the claim inside app:seeded reads exactly the rows the seed wrote', async () => {
        const engine = createEngine();
        const { ctx, seenAtSettle, read } = makeContext(engine, { metadata: true });

        await new AppPlugin(bundle()).start(ctx);

        const seeded = (engine.store.crm_case ?? []).map((r: any) => r.id);
        expect(seeded).toHaveLength(2);
        expect(seenAtSettle).toEqual([seeded]);
        expect(read()!.seededRecordIds!('crm_case')).toEqual(seeded);
    });

    it('a later boot replays the seed and re-reports the rows the earlier boot wrote', async () => {
        const engine = createEngine();
        await new AppPlugin(bundle()).start(makeContext(engine, { metadata: true }).ctx);
        const firstBoot = engine.store.crm_case.map((r: any) => r.id);
        // A row someone else wrote between boots, unowned on purpose.
        engine.store.crm_case.push({ id: 'guest_row', name: 'Guest enquiry', owner_id: null });

        const second = makeContext(engine, { metadata: true });
        await new AppPlugin(bundle()).start(second.ctx);

        expect(second.seenAtSettle).toEqual([firstBoot]);
        expect(second.read()!.seededRecordIds!('crm_case')).not.toContain('guest_row');
    });

    it('the basic-insert fallback publishes its rows too', async () => {
        const engine = createEngine();
        const { ctx, seenAtSettle } = makeContext(engine, { metadata: false });

        await new AppPlugin(bundle()).start(ctx);

        const seeded = (engine.store.crm_case ?? []).map((r: any) => r.id);
        expect(seeded).toHaveLength(2);
        expect(seenAtSettle).toEqual([seeded]);
    });

    it('the per-organization replayer records each replay under its organization', async () => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        const engine = createEngine();
        const { ctx, services, seenAtSettle, read } = makeContext(engine, { metadata: true });

        await new AppPlugin(bundle()).start(ctx);
        // Multi-tenant: no inline seed, so nothing settles and nothing is published.
        expect(seenAtSettle).toEqual([]);
        expect(read()!.seededRecordIds!('crm_case')).toEqual([]);

        const replayer = services.get('seed-replayer') as (orgId: string) => Promise<unknown>;
        expect(typeof replayer).toBe('function');
        await replayer('org_a');

        const orgRows = engine.store.crm_case.map((r: any) => r.id);
        expect(orgRows).toHaveLength(2);
        expect(read()!.seededRecordIds!('crm_case', 'org_a')).toEqual(orgRows);
        // The boot reading is not the organization's.
        expect(read()!.seededRecordIds!('crm_case')).toEqual([]);
    });
});

/**
 * #31021 — every seed load AppPlugin runs keeps, and honours, the record of
 * which seed rows landed in the organization it seeds (`sys_seed_landed_key`):
 * a row a person deleted is not inserted again by the next boot (`serve`'s
 * inline seed) or the next per-organization replay (what a host runs on an
 * upgrade), and the replayer's `{ reseed: true }` is the deliberate re-seed
 * that brings it back.
 *
 * The record object is registered the way `@objectstack/platform-objects`
 * registers it; the engine is the faithful double above, so every write the
 * loader makes lands in `engine.store`.
 */
describe('AppPlugin seed loads honour the record of landed seed rows (#31021)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    beforeEach(() => {
        delete process.env.OS_MULTI_ORG_ENABLED;
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
    });
    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    const LEDGER = 'sys_seed_landed_key';
    const objects: Record<string, any> = {
        ...OBJECTS,
        sys_organization: { name: 'sys_organization', systemFields: { tenant: false }, fields: { name: { type: 'text' } } },
        [LEDGER]: {
            name: LEDGER,
            fields: {
                object_name: { type: 'text' },
                seed_key: { type: 'textarea' },
                organization_id: { type: 'lookup', reference: 'sys_organization' },
            },
        },
    };
    const metadata = {
        getObject: vi.fn(async (name: string) => objects[name]),
        listObjects: vi.fn(async () => Object.values(objects)),
        get: vi.fn(async (_type: string, name: string) => objects[name]),
        list: vi.fn(async () => []),
        register: vi.fn(async () => {}),
        unregister: vi.fn(async () => {}),
        exists: vi.fn(async () => false),
        listNames: vi.fn(async () => []),
    };

    function context(engine: any) {
        const services = new Map<string, unknown>();
        const ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, svc: unknown) => {
                if (services.has(name)) throw new Error(`service '${name}' already registered`);
                services.set(name, svc);
            }),
            getService: vi.fn((name: string) => {
                if (name === 'objectql') return engine;
                if (name === 'metadata') return metadata;
                return services.get(name);
            }),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger: vi.fn(),
        } as unknown as PluginContext;
        return { ctx, services };
    }

    const cases = (engine: any, org: string) =>
        (engine.store.crm_case ?? []).filter((r: any) => r.organization_id === org).map((r: any) => r.name).sort();
    const upgraded = () => ({
        ...bundle(),
        data: [{ ...bundle().data[0], records: [...bundle().data[0].records, { name: 'CASE-3' }] }],
    });

    it("`serve`'s inline seed: a deleted row stays deleted across a reboot and an upgrade, whose new row lands", async () => {
        const engine = createEngine();
        // The `single` posture's Default Organization, created before seeds load.
        engine.store.sys_organization = [{ id: 'org_default', name: 'Default' }];

        await new AppPlugin(bundle()).start(context(engine).ctx);
        expect(cases(engine, 'org_default')).toEqual(['CASE-1', 'CASE-2']);
        expect(engine.store[LEDGER].map((r: any) => [r.organization_id, r.seed_key])).toEqual([
            ['org_default', '[["name","CASE-1"]]'],
            ['org_default', '[["name","CASE-2"]]'],
        ]);

        engine.store.crm_case = engine.store.crm_case.filter((r: any) => r.name !== 'CASE-2');
        await new AppPlugin(bundle()).start(context(engine).ctx);
        expect(cases(engine, 'org_default')).toEqual(['CASE-1']);

        await new AppPlugin(upgraded()).start(context(engine).ctx);
        expect(cases(engine, 'org_default')).toEqual(['CASE-1', 'CASE-3']);
    });

    it('the per-organization replay keeps it per organization, and `{ reseed: true }` is the door that brings a removed row back', async () => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        const engine = createEngine();
        const { ctx, services } = context(engine);
        await new AppPlugin(bundle()).start(ctx);
        const replayer = services.get('seed-replayer') as (orgId: string, options?: { reseed?: boolean }) => Promise<any>;

        await replayer('org_a');
        await replayer('org_b');
        engine.store.crm_case = engine.store.crm_case.filter((r: any) => !(r.organization_id === 'org_a' && r.name === 'CASE-1'));

        // The host's upgrade replay: org_a keeps its removal, org_b is untouched.
        const replay = await replayer('org_a');
        await replayer('org_b');
        expect(cases(engine, 'org_a')).toEqual(['CASE-2']);
        expect(cases(engine, 'org_b')).toEqual(['CASE-1', 'CASE-2']);
        expect(replay).toMatchObject({ inserted: 0, skipped: 2, errors: [] });

        // The deliberate re-seed.
        const reseed = await replayer('org_a', { reseed: true });
        expect(reseed).toMatchObject({ inserted: 1 });
        expect(cases(engine, 'org_a')).toEqual(['CASE-1', 'CASE-2']);
    });
});
