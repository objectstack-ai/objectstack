// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 D3 「写进清单 renamedFrom」, #30885] The install door's side
 * of a declared rename: step 2c″ reads each declaration against the table and
 * refuses what cannot be carried before any write; step 2f carries the rest
 * right before the new version registers, and puts them back when the carry
 * or the register fails; the answer names each carry (`renamesCarried`).
 *
 * The driver here is a stand-in with the `SqlDriver` members the door asks
 * (`planDeclaredRenames`, `carryDeclaredRenames`, `reverseDeclaredRenames`)
 * over an in-memory column set, judged by a small copy of the driver's carry
 * rule. The rule and every driver refusal are pinned on the real driver, on
 * SQLite and Postgres, in `@objectstack/driver-sql`'s
 * `sql-driver-declared-rename.test.ts`, and the whole path on a real boot in
 * `@objectstack/dogfood`'s `install-local-declared-rename.dogfood.test.ts`.
 * What this file pins is the door: the order of its steps, what it hands the
 * driver, its own refusals and its answers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// [#21321] An install binds the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top — never inside a clocked `it`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const VENDOR = 'com.acme.leads';
const INSTALLER = 'usr_installer';

const vendorBody = (version: string, objects: Row[], extra: Row = {}): Row => ({ id: VENDOR, namespace: 'acme', version, objects, ...extra });
const lead = (fields: Row): Row => ({ name: 'acme_lead', label: 'Lead', fields });
const V1 = vendorBody('1.0.0', [lead({ company: { type: 'text' } })]);
const V2 = vendorBody('2.0.0', [lead({ account_name: { type: 'text', renamedFrom: ['company'] } })]);

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(body: any) {
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

/**
 * A driver over in-memory tables: `columns` per table. Its plan is the
 * driver's carry rule in small (the old key has a column, the new key has
 * none, the old key is not live); `fail` makes one table's carry throw.
 */
function fakeDriver(tables: Record<string, Set<string>>, opts: { fail?: string; planThrows?: boolean; refuse?: string } = {}) {
    const log: string[] = [];
    const plan = async (table: string, object: { fields?: Row }, o: { liveKeys?: Iterable<string> } = {}) => {
        if (opts.planThrows) throw new Error('connect ECONNREFUSED');
        const live = new Set(o.liveKeys ?? Object.keys(object.fields ?? {}));
        const columns = tables[table] ?? new Set<string>();
        const carries: Array<{ table: string; from: string; to: string }> = [];
        const refusals: Array<{ table: string; field: string; from: string[]; reason: string; message: string }> = [];
        for (const [field, def] of Object.entries(object.fields ?? {})) {
            for (const old of (def as Row)?.renamedFrom ?? []) {
                if (live.has(old)) {
                    refusals.push({ table, field, from: [old], reason: 'live_key', message: `${table}.${field} declares \`renamedFrom\` '${old}': live.` });
                } else if (opts.refuse === field && columns.has(old)) {
                    refusals.push({ table, field, from: [old], reason: 'both_columns', message: `${table}.${field} declares \`renamedFrom\` '${old}': both.` });
                } else if (columns.has(old) && !columns.has(field)) {
                    carries.push({ table, from: old, to: field });
                }
            }
        }
        return { carries, refusals };
    };
    const driver = {
        log,
        tables,
        planDeclaredRenames: vi.fn(plan),
        carryDeclaredRenames: vi.fn(async (table: string, object: { fields?: Row }, o: { liveKeys?: Iterable<string> } = {}) => {
            log.push(`carry ${table}`);
            if (opts.fail === table) throw new Error(`rename failed on ${table}`);
            const p = await plan(table, object, o);
            for (const c of p.carries) {
                tables[table]!.delete(c.from);
                tables[table]!.add(c.to);
            }
            return p.carries;
        }),
        reverseDeclaredRenames: vi.fn(async (carries: Array<{ table: string; from: string; to: string }>) => {
            for (const c of carries) {
                log.push(`reverse ${c.table} ${c.to}→${c.from}`);
                tables[c.table]!.delete(c.to);
                tables[c.table]!.add(c.from);
            }
        }),
    };
    return driver;
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-declared-rename-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

async function mount(options: {
    installed?: Row;
    driver?: ReturnType<typeof fakeDriver>;
    /** What the registry serves for an object (the merged map). */
    served?: Record<string, Row>;
    register?: (body: any) => Promise<void> | void;
} = {}) {
    const order: string[] = [];
    const register = vi.fn(async (body: any) => {
        order.push('register');
        await options.register?.(body);
    });
    const syncSchemas = vi.fn(async () => { order.push('syncSchemas'); });
    const rawApp = makeRawApp();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas,
            ...(options.driver ? { getDriverForObject: () => options.driver } : {}),
            registry: { getObject: (name: string) => options.served?.[name] },
        }, INSTALLER),
    };
    const hooks = new Map<string, any>();
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const install = rawApp.routes.get('POST /api/v1/marketplace/install-local')!;
    if (options.installed) {
        const first = await install(makeC({ manifest: options.installed }));
        expect(first.status).toBe(200);
    }
    register.mockClear();
    syncSchemas.mockClear();
    order.length = 0;
    options.driver?.log.splice(0);
    if (options.driver) {
        options.driver.carryDeclaredRenames.mockClear();
        options.driver.planDeclaredRenames.mockClear();
    }
    return { install, register, syncSchemas, logger, order };
}

const ledgerFiles = (): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

describe('a declared rename the table can carry is carried before the new version registers (#30885)', () => {
    it('v1 → v2 renamedFrom [company]: carried before register, named in the answer and the log', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        const door = await mount({ installed: V1, driver, served: { acme_lead: lead({ company: { type: 'text' } }) } });
        const carryCalls = driver.carryDeclaredRenames;
        driver.carryDeclaredRenames = vi.fn(async (...a: any[]) => {
            door.order.push('carry');
            return (carryCalls as any)(...a);
        }) as any;

        const res = await door.install(makeC({ manifest: V2 }));

        expect(res.status).toBe(200);
        expect(res.payload.data.renamesCarried).toEqual([
            { object: 'acme_lead', table: 'acme_lead', from: 'company', to: 'account_name' },
        ]);
        expect(door.order).toEqual(['carry', 'register', 'syncSchemas']);
        expect([...driver.tables.acme_lead!]).toEqual(['id', 'account_name']);
        // The live keys handed to the driver: the served map, less what v1 of
        // this package contributes, plus what v2 brings.
        expect(driver.planDeclaredRenames.mock.calls[0]![2]).toEqual({ liveKeys: ['account_name'] });
        expect(door.logger.info.mock.calls.flat().join(' '))
            .toContain(`${VENDOR}: carried the declared rename acme_lead.company → acme_lead.account_name`);
    });

    it('nothing left to carry (a second install of the same version) installs with no `renamesCarried`', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'account_name']) });
        const door = await mount({ installed: V2, driver });
        const res = await door.install(makeC({ manifest: { ...V2, version: '2.0.1' } }));
        expect(res.status).toBe(200);
        expect(res.payload.data).not.toHaveProperty('renamesCarried');
        expect(driver.carryDeclaredRenames).not.toHaveBeenCalled();
    });

    it('a fresh install over a table that still holds the old column carries it for the object\'s owner', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        const door = await mount({ driver });
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(200);
        expect(res.payload.data.renamesCarried).toEqual([expect.objectContaining({ from: 'company', to: 'account_name' })]);
    });

    it('CONTROL: without renamedFrom the same upgrade is the 409 suspected rename, and nothing is carried', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        const door = await mount({ installed: V1, driver });
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', [lead({ account_name: { type: 'text' } })]) }));
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('SCHEMA_UPGRADE_CONFIRMATION_REQUIRED');
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({ kind: 'suspected_rename', field: 'company' })]);
        expect(driver.carryDeclaredRenames).not.toHaveBeenCalled();
    });
});

describe('a declared rename that cannot be carried is refused 422 before any write, naming the field, the old key and the reason (#30885)', () => {
    const refusedBefore = async (door: Awaited<ReturnType<typeof mount>>, driver: ReturnType<typeof fakeDriver> | undefined, before: Record<string, string>) => {
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        if (driver) expect(driver.carryDeclaredRenames).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    };

    it('a driver refusal (`both_columns`) is answered with the driver\'s own refusal', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company', 'account_name']) }, { refuse: 'account_name' });
        const door = await mount({ installed: V1, driver });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        expect(res.payload.error.details.refusals).toEqual([expect.objectContaining({
            object: 'acme_lead', field: 'account_name', from: ['company'], reason: 'both_columns',
        })]);
        expect(res.payload.error.message).toContain('Nothing was installed or written');
        await refusedBefore(door, driver, before);
    });

    it('`live_key`: another package\'s extension still declares the old key in the served map', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        // v1 of this package declares `company`; another package's extension
        // ALSO declares it, so the merged map keeps it once v2 is in place.
        const served = { acme_lead: lead({ company: { type: 'text' } }) };
        const door = await mount({ installed: vendorBody('1.0.0', [lead({ other: { type: 'text' } })]), driver, served });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(422);
        expect(res.payload.error.details.refusals).toEqual([expect.objectContaining({ field: 'account_name', reason: 'live_key' })]);
        await refusedBefore(door, driver, before);
    });

    it('`destructive_type`: the renamed field turns a type that stores no column', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        const door = await mount({ installed: V1, driver });
        const before = ledgerFiles();
        const res = await door.install(makeC({
            manifest: vendorBody('2.0.0', [lead({ account_name: { type: 'formula', expression: '1', renamedFrom: ['company'] } })]),
        }));
        expect(res.status).toBe(422);
        expect(res.payload.error.details.refusals).toEqual([expect.objectContaining({
            object: 'acme_lead', field: 'account_name', from: ['company'], reason: 'destructive_type',
        })]);
        await refusedBefore(door, driver, before);
    });

    it('`outside_package`: an extension\'s field names a column its own package never contributed (the owner\'s just-dropped key)', async () => {
        // The owner's table still holds `company` (the owner dropped it); this
        // package only ever extended the object with `nickname`.
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company', 'nickname']) });
        const ext = (version: string, fields: Row) => ({
            id: 'com.acme.ext', namespace: 'acmeext', version, objectExtensions: [{ extend: 'acme_lead', fields }],
        });
        const served = { acme_lead: lead({ nickname: { type: 'text' } }) };
        const door = await mount({ installed: ext('1.0.0', { nickname: { type: 'text' } }), driver, served });
        const before = ledgerFiles();
        const res = await door.install(makeC({
            manifest: ext('2.0.0', { nickname: { type: 'text' }, client: { type: 'text', renamedFrom: ['company'] } }),
        }));
        expect(res.status).toBe(422);
        expect(res.payload.error.details.refusals).toEqual([expect.objectContaining({
            object: 'acme_lead', field: 'client', from: ['company'], reason: 'outside_package',
        })]);
        await refusedBefore(door, driver, before);
    });

    it('CONTROL: an extension\'s field carries its own earlier key', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company', 'nickname']) });
        const ext = (version: string, fields: Row) => ({
            id: 'com.acme.ext', namespace: 'acmeext', version, objectExtensions: [{ extend: 'acme_lead', fields }],
        });
        const served = { acme_lead: lead({ company: { type: 'text' }, nickname: { type: 'text' } }) };
        const door = await mount({ installed: ext('1.0.0', { nickname: { type: 'text' } }), driver, served });
        const res = await door.install(makeC({ manifest: ext('2.0.0', { alias: { type: 'text', renamedFrom: ['nickname'] } }) }));
        expect(res.status).toBe(200);
        expect(res.payload.data.renamesCarried).toEqual([expect.objectContaining({ from: 'nickname', to: 'alias' })]);
        // The owner's `company` stays live in the map the driver was handed.
        expect([...driver.planDeclaredRenames.mock.calls[0]![2]!.liveKeys!]).toEqual(['company', 'alias']);
    });

    it('`transport`: a driver with no declared-rename members refuses a pending rename by name', async () => {
        const door = await mount({ installed: V1 });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(422);
        expect(res.payload.error.details.refusals).toEqual([expect.objectContaining({ field: 'account_name', reason: 'transport' })]);
        await refusedBefore(door, undefined, before);
    });

    it('a table that cannot be read answers 503, never "nothing to carry"', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) }, { planThrows: true });
        const door = await mount({ installed: V1, driver });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        await refusedBefore(door, driver, before);
    });
});

describe('a failure after the carry leaves the installed version serving its columns (#30885)', () => {
    const TWO = (version: string, renamed: boolean) => vendorBody(version, [
        lead(renamed ? { account_name: { type: 'text', renamedFrom: ['company'] } } : { company: { type: 'text' } }),
        { name: 'acme_deal', label: 'Deal', fields: renamed ? { amount: { type: 'number', renamedFrom: ['amt'] } } : { amt: { type: 'number' } } },
    ]);

    it('a carry that fails mid-way puts back the tables already carried, answers 500, and installs nothing', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']), acme_deal: new Set(['id', 'amt']) }, { fail: 'acme_deal' });
        const door = await mount({ installed: TWO('1.0.0', false), driver });
        const before = ledgerFiles();

        const res = await door.install(makeC({ manifest: TWO('2.0.0', true) }));

        expect(res.status).toBe(500);
        expect(res.payload.error.code).toBe('INTERNAL_ERROR');
        expect(res.payload.error.message).toContain('put back');
        expect(driver.log).toEqual(['carry acme_lead', 'carry acme_deal', 'reverse acme_lead account_name→company']);
        expect([...driver.tables.acme_lead!]).toEqual(['id', 'company']);
        expect([...driver.tables.acme_deal!]).toEqual(['id', 'amt']);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });

    it('a register that fails (an imported manifest) puts the carried columns back', async () => {
        const driver = fakeDriver({ acme_lead: new Set(['id', 'company']) });
        const door = await mount({
            installed: V1,
            driver,
            register: (body: any) => { if (body?.version === '2.0.0') throw new Error('bad manifest'); },
        });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expect(driver.log).toEqual(['carry acme_lead', 'reverse acme_lead account_name→company']);
        expect([...driver.tables.acme_lead!]).toEqual(['id', 'company']);
        expect(ledgerFiles()).toEqual(before);
    });
});
