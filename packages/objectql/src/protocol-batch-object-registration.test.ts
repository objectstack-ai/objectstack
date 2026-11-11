// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32369, ADR-0144 D2 and D6, amended; ADR-0067 D2] A batch metadata writer
 * never stores an object the registry refuses and reports it written.
 *
 * Each batch face asks the registry about a row's body alone while it writes
 * (#29673: a later sibling can still complete a pair), so before this card the
 * write-through's refusal of a row whose currency pair the registry refuses was
 * only `console.warn`ed: D6's roll-up door left the row stored and
 * unregistered, and the follow door (which `registerObject` never asks) let a
 * row whose amount follows no code field register outright — and the batch
 * answered it copied, imported or published. Measured on `main` for the
 * duplicate: `success: true, failed: []`, with both rows stored.
 *
 * Each face now judges its object rows as ONE unit once they are all in
 * (`batch-object-registration.ts`) and answers a refused row in its own
 * failure shape, with nothing of it left stored:
 *  - `duplicatePackage` — per row, in `failed[]`; the copy is taken back
 *    (removed, or restored to the copy it overwrote);
 *  - `importUnmanagedPackage` — the whole import refused and rolled back;
 *  - `publishPackageDrafts` — the batch refused with the row as its cause,
 *    every promotion undone (here on a runtime that cannot roll back);
 *  - `saveMetaItem` on the `external-import` face — one object, so it asks
 *    against the registry like a single save: `422`, nothing stored;
 *  - `registerApp` after the seal — the follow pair asked once the body's
 *    objects AND its `objectExtensions` are in.
 * And each pins the #29673 case: a row whose pair a later sibling of the same
 * batch completes still succeeds.
 *
 * Real kernel, real `SchemaRegistry`, real protocol; only the driver is an
 * in-memory double. It declares `transactionsUnsupported` because it cannot
 * roll a transaction back — the runtime the publish's undo path serves.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-duplicate-package-unprefixed-object.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
                if (!(v as any).$in.includes(row[k])) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0',
        // It cannot roll a transaction back, and says so.
        supports: { transactionsUnsupported: true } as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = (data.id as string) ?? `r_${randomUUID()}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
    };
    return driver;
}

interface Harness {
    kernel: ObjectKernel;
    engine: ObjectQL;
    stores: Stores;
    protocol: any;
}

let current: Harness | undefined;

async function boot(): Promise<Harness> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const stores: Stores = new Map();
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.bootstrap();
    current = { kernel, engine, stores, protocol: kernel.getService('protocol') };
    return current;
}

afterEach(async () => {
    vi.restoreAllMocks();
    if (current && current.kernel.getState() === 'running') await current.kernel.shutdown();
    current = undefined;
});

const activeRow = (h: Harness, type: string, name: string, packageId: string): Record<string, unknown> | undefined =>
    Array.from(h.stores.get('sys_metadata')?.values() ?? []).find(
        (r) => r.type === type && r.name === name && r.package_id === packageId && r.state === 'active',
    );
const bodyOf = (row: Record<string, unknown> | undefined): any =>
    (row === undefined ? undefined : typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata);
const registered = (h: Harness, name: string): any => h.engine.registry.getObject(name);

// ── Fixtures: one invoice, and the currency pairs around it (ADR-0144) ──────
const CODE = { valueDomain: 'iso_4217_currency' };
/** The parent: a text `title` and a currency-code `currency_code`. */
const invoice = (ns: string, extra: Record<string, unknown> = {}) => ({
    name: `${ns}_invoice`, label: 'Invoice', sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        currency_code: { name: 'currency_code', type: 'text', label: 'Currency', ...CODE },
        ...extra,
    },
});
/** A child line whose amount FOLLOWS its invoice through `pointer`. */
const followingLine = (ns: string, name: string, pointer: string) => ({
    name: `${ns}_${name}`, label: name, sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        invoice: { name: 'invoice', type: 'master_detail', reference: `${ns}_invoice`, label: 'Invoice' },
        amount: { name: 'amount', type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: pointer } },
    },
});
/** A child line whose amount carries its OWN currency per row. */
const ownCurrencyLine = (ns: string) => ({
    name: `${ns}_own_line`, label: 'Own line', sharingModel: 'private',
    fields: {
        invoice: { name: 'invoice', type: 'master_detail', reference: `${ns}_invoice`, label: 'Invoice' },
        currency_code: { name: 'currency_code', type: 'text', label: 'Currency', ...CODE },
        amount: { name: 'amount', type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
    },
});
/** A roll-up of the own-currency line's amount: refused by D6's roll-up door. */
const ownCurrencyTotal = (ns: string) => ({
    name: `${ns}_own_total`, label: 'Own total', sharingModel: 'private',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        total: { name: 'total', type: 'summary', label: 'Total', summaryOperations: { object: `${ns}_own_line`, field: 'amount', function: 'sum' } },
    },
});

describe('duplicatePackage: a copy the registry refuses is reported failed, and not left stored (#32369)', () => {
    const P = 'com.qa.dupsrc';
    const Q = 'com.qa.dupdst';

    async function sourcePackage(h: Harness): Promise<void> {
        await h.protocol.installPackage({ manifest: { id: P, name: 'Source', type: 'app' } });
        // Saved in this order, each on a face that asks the body alone, so the
        // source holds every pair as a batch would have written it.
        for (const item of [
            // [#29673] A good line BEFORE its invoice: the copy writes it first too.
            followingLine('dupsrc', 'early_line', 'invoice.currency_code'),
            // Follows the invoice's TEXT field: the follow door refuses the pair.
            followingLine('dupsrc', 'bad_line', 'invoice.title'),
            invoice('dupsrc'),
            ownCurrencyLine('dupsrc'),
            // D6's roll-up door refuses it at registration.
            ownCurrencyTotal('dupsrc'),
        ]) {
            await h.protocol.saveMetaItem({ type: 'object', name: item.name, packageId: P, item });
        }
    }

    it('answers each refused row in failed[] with the registry refusal, never in copied[]; nothing of it is stored or registered', async () => {
        const h = await boot();
        await sourcePackage(h);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.success).toBe(false);
        expect(res.failed.map((f: any) => f.name).sort()).toEqual(['dupsrc_bad_line', 'dupsrc_own_total']);
        for (const f of res.failed) expect(f.type).toBe('object');
        const bad = res.failed.find((f: any) => f.name === 'dupsrc_bad_line');
        expect(bad.error).toMatch(/currency/i);
        expect(bad.error).toMatch(/title/);
        expect(res.copied.map((c: any) => c.name).sort()).toEqual(['dupdst_early_line', 'dupdst_invoice', 'dupdst_own_line']);
        expect(res).toMatchObject({ copiedCount: 3, failedCount: 2 });

        for (const name of ['dupdst_bad_line', 'dupdst_own_total']) {
            expect(activeRow(h, 'object', name, Q), `${name} is not left stored`).toBeUndefined();
            expect(registered(h, name), `${name} is not left registered`).toBeUndefined();
        }
        expect(warn.mock.calls.some(([m]) => String(m).includes('[protocol.duplicatePackage]') && String(m).includes('dupsrc_bad_line'))).toBe(true);
    });

    it('[#29673] copies and registers a row whose pair a later row of the same copy completes', async () => {
        const h = await boot();
        await sourcePackage(h);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.duplicatePackage({ sourcePackageId: P, targetPackageId: Q });

        expect(res.copied).toContainEqual({ type: 'object', name: 'dupdst_early_line' });
        expect(activeRow(h, 'object', 'dupdst_early_line', Q)).toBeDefined();
        expect(registered(h, 'dupdst_early_line')?.fields?.amount?.currencyConfig).toMatchObject({ currencyField: 'invoice.currency_code' });
        expect(registered(h, 'dupdst_invoice')).toBeDefined();
        expect(registered(h, 'dupdst_own_line')).toBeDefined();
    });
});

describe('importUnmanagedPackage: a refused object refuses the import and nothing of the package stays (#32369)', () => {
    const SOURCE = 'com.vendor.billing';
    const Q = 'com.qa.billing-copy';
    const packageBody = (objects: unknown[]) => ({ id: SOURCE, name: 'Billing', version: '1.0.0', type: 'app', namespace: 'billing', objects });

    it('answers 422 with the refused object, and rolls the base and every copied row back', async () => {
        const h = await boot();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let error: any;
        try {
            await h.protocol.importUnmanagedPackage({
                manifest: packageBody([
                    invoice('billing'),
                    followingLine('billing', 'line', 'invoice.currency_code'),
                    followingLine('billing', 'bad_line', 'invoice.title'),
                ]),
                targetPackageId: Q,
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeDefined();
        expect(error).toMatchObject({ status: 422, code: 'INVALID_METADATA' });
        expect(error.message).toMatch(/billing_bad_line/);
        expect(error.details).toMatchObject({ failedItem: { name: 'billing_bad_line' }, rolledBack: true });
        const left = Array.from(h.stores.get('sys_metadata')?.values() ?? []).filter((r) => r.package_id === Q && r.state === 'active');
        expect(left, 'nothing of the imported package stays stored').toEqual([]);
        for (const name of ['billing_invoice', 'billing_line', 'billing_bad_line']) {
            expect(registered(h, name), `${name} is not left registered`).toBeUndefined();
        }
    });

    it('[#29673] imports a line declared before the invoice it follows', async () => {
        const h = await boot();
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.importUnmanagedPackage({
            manifest: packageBody([
                followingLine('billing', 'line', 'invoice.currency_code'),
                invoice('billing'),
            ]),
            targetPackageId: Q,
        });

        expect(res.copied.map((c: any) => c.name).sort()).toEqual(['billing_invoice', 'billing_line']);
        expect(registered(h, 'billing_line')).toBeDefined();
        expect(registered(h, 'billing_invoice')).toBeDefined();
    });
});

describe('publishPackageDrafts: a promoted unit the registry refuses refuses the publish (#32369)', () => {
    const P = 'com.qa.pubpkg';

    it('answers the refused draft in failed[], and a runtime that cannot roll back keeps nothing of the batch live', async () => {
        const h = await boot();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await h.protocol.installPackage({ manifest: { id: P, name: 'Pub', type: 'app' } });
        for (const item of [invoice('pubpkg'), followingLine('pubpkg', 'bad_line', 'invoice.title')]) {
            await h.protocol.saveMetaItem({ type: 'object', name: item.name, packageId: P, item, mode: 'draft' });
        }

        const res = await h.protocol.publishPackageDrafts({ packageId: P });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        const causal = res.failed.find((f: any) => f.code !== 'BATCH_ABORTED');
        expect(causal).toMatchObject({ name: 'pubpkg_bad_line', code: 'INVALID_METADATA' });
        expect(causal.error).toMatch(/title/);
        for (const name of ['pubpkg_invoice', 'pubpkg_bad_line']) {
            expect(activeRow(h, 'object', name, P), `${name} is not left live`).toBeUndefined();
            expect(registered(h, name), `${name} is not left registered`).toBeUndefined();
        }
    });

    it('[ADR-0144 D6] registers a roll-up whose child amount a LATER draft of the same publish makes follow the parent', async () => {
        const h = await boot();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await h.protocol.installPackage({ manifest: { id: P, name: 'Pub', type: 'app' } });
        // Live: the invoice, and a line whose amount carries its own currency.
        const line = { ...ownCurrencyLine('pubpkg'), name: 'pubpkg_line' };
        await h.protocol.saveMetaItem({ type: 'object', name: 'pubpkg_invoice', packageId: P, item: invoice('pubpkg') });
        await h.protocol.saveMetaItem({ type: 'object', name: 'pubpkg_line', packageId: P, item: line });
        // Drafted: the invoice gains a roll-up of the line's amount (alone,
        // D6 refuses it), and the line's amount now follows the invoice.
        await h.protocol.saveMetaItem({
            type: 'object', name: 'pubpkg_invoice', packageId: P, mode: 'draft',
            item: invoice('pubpkg', {
                total: { name: 'total', type: 'summary', label: 'Total', summaryOperations: { object: 'pubpkg_line', field: 'amount', function: 'sum' } },
            }),
        });
        await h.protocol.saveMetaItem({
            type: 'object', name: 'pubpkg_line', packageId: P, mode: 'draft', force: true,
            item: followingLine('pubpkg', 'line', 'invoice.currency_code'),
        });

        const res = await h.protocol.publishPackageDrafts({ packageId: P });

        expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
        expect(res.published.map((p: any) => p.name)).toEqual(['pubpkg_invoice', 'pubpkg_line']);
        expect(registered(h, 'pubpkg_invoice')?.fields?.total).toBeDefined();
        expect(registered(h, 'pubpkg_line')?.fields?.amount?.currencyConfig).toMatchObject({ currencyField: 'invoice.currency_code' });
    });
});

describe('the external-import face saves one object, so it asks against the registry (#32369)', () => {
    it('answers 422 for a pair the follow door refuses, and stores nothing', async () => {
        const h = await boot();
        await h.protocol.saveMetaItem({ type: 'object', name: 'ext_invoice', item: invoice('ext') });
        let error: any;
        try {
            await h.protocol.saveMetaItem({
                type: 'object', name: 'ext_bad_line', item: followingLine('ext', 'bad_line', 'invoice.title'), writeFace: 'external-import',
            });
        } catch (e) {
            error = e;
        }

        expect(error).toMatchObject({ status: 422, code: 'INVALID_METADATA' });
        expect(Array.from(h.stores.get('sys_metadata')?.values() ?? []).some((r) => r.name === 'ext_bad_line')).toBe(false);
        expect(registered(h, 'ext_bad_line')).toBeUndefined();
    });
});

describe('registerApp after the seal asks the follow pair once the body is whole (#32369)', () => {
    const parentPackage = {
        id: 'com.qa.ledger', name: 'Ledger', version: '1.0.0', type: 'app', namespace: 'ledger',
        objects: [{ name: 'ledger_invoice', label: 'Invoice', sharingModel: 'private', fields: { title: { name: 'title', type: 'text', label: 'Title' } } }],
    };
    const childLine = (pointer: string) => ({
        name: 'lines_line', label: 'Line', sharingModel: 'private',
        fields: {
            invoice: { name: 'invoice', type: 'master_detail', reference: 'ledger_invoice', label: 'Invoice' },
            amount: { name: 'amount', type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: pointer } },
        },
    });

    it('installs a package whose own objectExtensions supply the code field its object follows', async () => {
        const h = await boot();
        expect((h.engine.registry as any).bareNameHoldersAreSealed).toBe(true);
        h.engine.registerApp(parentPackage);

        h.engine.registerApp({
            id: 'com.qa.lines', name: 'Lines', version: '1.0.0', type: 'app', namespace: 'lines',
            objects: [childLine('invoice.lines_currency_code')],
            objectExtensions: [{ extend: 'ledger_invoice', fields: { lines_currency_code: { name: 'lines_currency_code', type: 'text', label: 'Currency', ...CODE } } }],
        });

        expect(registered(h, 'lines_line')).toBeDefined();
        expect(registered(h, 'ledger_invoice')?.fields?.lines_currency_code).toBeDefined();
    });

    it('refuses a package whose object follows no code field, and puts back everything it registered', async () => {
        const h = await boot();
        h.engine.registerApp(parentPackage);
        let error: any;
        try {
            h.engine.registerApp({
                id: 'com.qa.lines', name: 'Lines', version: '1.0.0', type: 'app', namespace: 'lines',
                objects: [childLine('invoice.title')],
            });
        } catch (e) {
            error = e;
        }

        expect(error).toMatchObject({ status: 422, code: 'INVALID_METADATA' });
        expect(registered(h, 'lines_line')).toBeUndefined();
        expect(h.engine.registry.getPackage('com.qa.lines')).toBeUndefined();
    });
});

describe('migrateStoredMetadata: a rewrite the registry refuses is reported failed and taken back (#32369)', () => {
    const P = 'com.qa.migpkg';

    it('answers the row failed with the registry refusal, and the store holds the row as it was before the pass', async () => {
        const h = await boot();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await h.protocol.installPackage({ manifest: { id: P, name: 'Mig', type: 'app' } });
        const inv = invoice('migpkg');
        await h.protocol.saveMetaItem({ type: 'object', name: inv.name, packageId: P, item: inv });
        // A line whose amount follows the invoice's TEXT field, saved on a face
        // that asks the body alone (as a batch wrote it), with a lookup the
        // conversion chain rewrites: at rest it still spells the retired
        // `reference_to` alias (protocol 17), in the row and in its history.
        const bad = followingLine('migpkg', 'bad_line', 'invoice.title');
        const line = {
            ...bad,
            fields: { ...bad.fields, source_ref: { name: 'source_ref', type: 'lookup', label: 'Source', reference: 'migpkg_invoice' } },
        };
        await h.protocol.saveMetaItem({ type: 'object', name: line.name, packageId: P, item: line });
        const legacy = (body: any) => {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body;
            const { reference, ...rest } = parsed.fields.source_ref;
            const out = { ...parsed, fields: { ...parsed.fields, source_ref: { ...rest, reference_to: reference } } };
            return typeof body === 'string' ? JSON.stringify(out) : out;
        };
        const stored = activeRow(h, 'object', line.name, P)!;
        stored.metadata = legacy(stored.metadata);
        for (const r of h.stores.get('sys_metadata_history')?.values() ?? []) {
            if (r.name === line.name && r.version === stored.version) r.metadata = legacy(r.metadata);
        }

        const report: any = await h.protocol.migrateStoredMetadata({ types: ['object'], apply: true });

        const row = report.rows.find((r: any) => r.name === line.name);
        expect(row?.outcome).toBe('failed');
        expect(row.reason).toMatch(/title/);
        expect(row.reason).toMatch(/taken back/);
        expect(report).toMatchObject({ rewritten: 0, failed: 1 });
        // The store holds the row the pass read — the alias, not the rewrite.
        const after = bodyOf(activeRow(h, 'object', line.name, P));
        expect(after.fields.source_ref.reference_to).toBe('migpkg_invoice');
        expect(after.fields.source_ref.reference).toBeUndefined();
    });
});
