// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28914] `GET /packages/export` — the deployment's whole ontology as
 * installable packages, in one read (`PackageExportBundleSchema`).
 *
 * The door is the real dispatcher over a registry and protocol double, so what
 * is pinned is the door's own rules, each the declaration's:
 *
 *  - the per-package export's read gate, asked before anything is read;
 *  - a closed, empty query set (a parameter is refused 400 `VALIDATION_ERROR`,
 *    naming it);
 *  - which packages: every registry row whose `source` is not `code`, a
 *    disabled one included, each once;
 *  - the order: dependencies first (ADR-0141 D5), whatever order the registry
 *    lists the rows in, so a `.custom` pair follows its base;
 *  - one producer: each entry is exactly what `GET /packages/:id/export`
 *    answers for that package;
 *  - whole or absent: a package whose export cannot be assembled fails the
 *    read, naming it, and no bundle is answered.
 *
 * The round trip onto a fresh runtime, and the connector credential that stays
 * a reference, run on real showcase boots in
 * `packages/qa/dogfood/test/package-export-bundle-round-trip.dogfood.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { PackageExportBundleSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';
import { ROUTE_LEDGER } from '../route-ledger.js';

const BASE = 'com.example.crm';
const PAIR = 'com.example.crm.custom';
const EXT = 'com.example.billing';
const OFF = 'com.example.archive';
const CODE = 'com.example.host';

const ctx = (executionContext: any): any => ({ request: {}, environmentId: 'platform', executionContext });
const system = () => ctx({ isSystem: true });
const holding = (caps: string[]) => ctx({ userId: 'u_1', isSystem: false, systemPermissions: caps });

/** Registry rows, listed dependents FIRST, so only a real sort puts the base ahead. */
const ROWS = [
    { id: EXT, source: 'marketplace', enabled: true, manifest: { id: EXT, name: 'billing', version: '2.0.0', namespace: 'billing', dependencies: { [BASE]: '^1' } } },
    { id: PAIR, source: 'authored', enabled: true, manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', namespace: 'crm_custom', dependencies: { [BASE]: '^1' } } },
    { id: CODE, source: 'code', enabled: true, manifest: { id: CODE, name: 'host', version: '1.0.0' } },
    { id: BASE, source: 'marketplace', enabled: true, manifest: { id: BASE, name: 'crm', version: '1.2.0', namespace: 'crm' } },
    { id: OFF, source: 'authored', enabled: false, status: 'disabled', manifest: { id: OFF, name: 'archive', version: '1.0.0' } },
];

/** Each package's own items, as the per-package layer answers them. */
const ITEMS: Record<string, Record<string, any[]>> = {
    [BASE]: { object: [{ name: 'crm_account', label: 'Account', fields: {}, _packageId: BASE }], dashboard: [{ name: 'crm_pulse', label: 'Pulse', _packageId: BASE }] },
    [PAIR]: { dashboard: [{ name: 'crm_pulse', label: 'Pulse (customized)', overrides: { package: BASE, basedOn: '1.2.0' }, _packageId: PAIR }] },
    [EXT]: { flow: [{ name: 'billing_close', label: 'Close', _packageId: EXT }] },
    [OFF]: { report: [{ name: 'archive_old', label: 'Old', _packageId: OFF }] },
    [CODE]: { object: [{ name: 'host_thing', label: 'Thing', _packageId: CODE }] },
};

function make(over: { protocol?: any; rows?: any[] } = {}) {
    const rows = over.rows ?? ROWS;
    const registry = {
        getAllPackages: vi.fn(() => rows),
        getPackage: vi.fn((id: string) => rows.find((r) => r.id === id)),
    };
    const protocol = over.protocol === undefined
        ? {
            getMetaItemsPerPackage: vi.fn(async ({ type, packageId }: { type: string; packageId: string }) => ({ items: ITEMS[packageId]?.[type] ?? [] })),
            getMetaItems: vi.fn(async () => ({ items: [] })),
        }
        : over.protocol;
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? { registry } : name === 'protocol' ? protocol : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry, protocol };
}

const bundleOf = (r: any): any => r.response?.body?.data;

describe('[#28914] GET /packages/export answers the whole deployment as installable packages', () => {
    it('answers every package whose registry row is not `code`, a disabled one included, each once, and parses as the declared bundle', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, system());
        expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(200);
        const bundle = bundleOf(r);
        expect(PackageExportBundleSchema.safeParse(bundle).success).toBe(true);
        const ids = bundle.packages.map((p: any) => p.id);
        expect([...ids].sort()).toEqual([BASE, PAIR, EXT, OFF].sort());
        expect(ids).not.toContain(CODE);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('lists dependencies first: the base before its `.custom` pair and before the package that depends on it', async () => {
        const { dispatcher } = make();
        const ids = bundleOf(await dispatcher.handlePackages('/export', 'GET', undefined, {}, system())).packages.map((p: any) => p.id);
        // CONTROL: the registry lists both dependents ahead of the base.
        expect(ROWS.map((r) => r.id).indexOf(BASE)).toBeGreaterThan(ROWS.map((r) => r.id).indexOf(PAIR));
        expect(ids.indexOf(BASE)).toBeLessThan(ids.indexOf(PAIR));
        expect(ids.indexOf(BASE)).toBeLessThan(ids.indexOf(EXT));
    });

    it('each entry is exactly what `GET /packages/:id/export` answers for that package (one producer)', async () => {
        const { dispatcher } = make();
        const bundle = bundleOf(await dispatcher.handlePackages('/export', 'GET', undefined, {}, system()));
        for (const entry of bundle.packages) {
            const single = await dispatcher.handlePackages(`/${encodeURIComponent(entry.id)}/export`, 'GET', undefined, {}, system());
            expect(single.response?.status).toBe(200);
            expect(entry).toEqual(single.response?.body?.data);
        }
        const pair = bundle.packages.find((p: any) => p.id === PAIR);
        expect(pair).toMatchObject({ namespace: 'crm_custom', dependencies: { [BASE]: '^1' } });
        expect(pair.dashboards).toEqual([{ name: 'crm_pulse', label: 'Pulse (customized)', overrides: { package: BASE, basedOn: '1.2.0' } }]);
    });

    it('answers an empty list when every package is registered by the deployment\'s own code', async () => {
        const { dispatcher } = make({ rows: ROWS.filter((r) => r.source === 'code') });
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, system());
        expect(r.response?.status).toBe(200);
        expect(bundleOf(r)).toEqual({ packages: [] });
    });

    it('reads with the per-package export\'s gate: `studio.access` or `setup.access`, else 403 before anything is read', async () => {
        for (const caps of [['studio.access'], ['setup.access']]) {
            const { dispatcher } = make();
            const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, holding(caps));
            expect(r.response?.status, caps.join()).toBe(200);
        }
        const { dispatcher, registry, protocol } = make();
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, holding(['manage_metadata']));
        expect(r.response?.status).toBe(403);
        expect(registry.getAllPackages).not.toHaveBeenCalled();
        expect(protocol.getMetaItemsPerPackage).not.toHaveBeenCalled();
    });

    it('refuses any query parameter 400 VALIDATION_ERROR, naming it, before anything is read', async () => {
        const { dispatcher, registry } = make();
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, { format: 'zip' }, system());
        expect(r.response?.status).toBe(400);
        expect(r.response?.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(r.response?.body?.error?.message).toContain('format');
        expect(registry.getAllPackages).not.toHaveBeenCalled();
    });

    it('is whole or absent: a package whose export the protocol cannot assemble fails the read, naming it', async () => {
        const { dispatcher } = make({ protocol: null });
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, system());
        expect(r.response?.status).toBe(500);
        expect(r.response?.body?.data).toBeUndefined();
        expect(r.response?.body?.error?.message).toContain(`'${BASE}'`);
    });

    it('is whole or absent: a package whose export throws fails the read with its status, naming that package', async () => {
        let reads = 0;
        const protocol = {
            getMetaItemsPerPackage: async ({ type, packageId }: { type: string; packageId: string }) => ({ items: ITEMS[packageId]?.[type] ?? [] }),
            // Read once per assembled package: the second package's assembly throws.
            get getMetaItems() {
                reads += 1;
                if (reads === 2) throw Object.assign(new Error('metadata store unavailable'), { status: 503 });
                return async () => ({ items: [] });
            },
        };
        const { dispatcher } = make({ protocol });
        const r = await dispatcher.handlePackages('/export', 'GET', undefined, {}, system());
        expect(r.response?.status).toBe(503);
        expect(r.response?.body?.data).toBeUndefined();
        const message: string = r.response?.body?.error?.message ?? '';
        expect(message).toMatch(/^The export of package '[^']+' could not be assembled/);
        expect(message).toContain('metadata store unavailable');
        expect(message).not.toContain(`'${BASE}'`);
    });

    it('is not read as a package id: `export` never reaches `GET /packages/:id`', async () => {
        const { dispatcher, registry } = make();
        await dispatcher.handlePackages('/export', 'GET', undefined, {}, system());
        expect(registry.getPackage).not.toHaveBeenCalledWith('export');
    });

    it('has its route-ledger row: the SDK method and the declared response schema', () => {
        const row = ROUTE_LEDGER.find((e) => e.route === 'GET /packages/export');
        expect(row?.client).toBe('packages.exportAll');
        expect(row?.responseSchema).toBe('PackageExportBundleSchema');
    });
});
