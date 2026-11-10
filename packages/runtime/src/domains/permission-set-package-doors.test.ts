// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D5, #32164] The two doors that address a permission set by name
 * — the activation door (`POST /security/_activation/permission/:name`) and the
 * clone door (`POST /security/permission-sets/:name/clone`) — over a set two
 * packages hold, and `?package=`, the exact qualifier both now take.
 *
 * The catalog is the real reader (`createSecurityCatalogReader`) over a
 * stand-in registry carrying the package-scoped reads, because a name two
 * packages hold cannot be registered on a real registry before the narrowing
 * (#31698 PR-2). The one-holder CONTROLs are what a real environment answers.
 *
 * BASE (main e40f2df2, measured in step 0 on a booted showcase over a stand-in
 * holder pair — comment 6769973229 on #32164):
 *  - two holders, no package: both doors answered `404 RESOURCE_NOT_FOUND`
 *    ("has no definition — there is nothing to switch off / to clone");
 *  - `?package=` was dropped without a word, so the same `404`;
 *  - the activation body's `package` key is refused as an unknown field (still);
 *  - a clone TARGET name two packages hold was not taken (the reader's
 *    by-name read answers nothing for a refused name), so the copy was saved.
 */

import '@objectstack/metadata';
import { describe, it, expect } from 'vitest';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const LEDGER = 'sys_metadata_activation';
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const OTHER = 'com.acme.other';
/** Held by CRM and HR. */
const TWO = 'shared_reader';
/** Held by CRM alone. */
const ONE = 'crm_sales_rep';

type Row = Record<string, unknown>;
const setOf = (name: string, packageId: string) => ({
    name,
    label: `${name} (${packageId})`,
    objects: { account: { allowRead: true } },
    _packageId: packageId,
});
const holders: Record<string, string[]> = { [TWO]: [CRM, HR], [ONE]: [CRM] };

function boot() {
    const packages: Record<string, { manifest: Row }> = {
        [CRM]: { manifest: { id: CRM, namespace: 'crm', version: '1.0.0' } },
        [HR]: { manifest: { id: HR, namespace: 'hr', version: '1.0.0' } },
        [OTHER]: { manifest: { id: OTHER, namespace: 'other', version: '1.0.0' } },
    };
    const tables: Record<string, Row[]> = { [LEDGER]: [] };
    const writes: Row[] = [];
    let nextId = 1;
    const engine: any = {
        // Both packages are booted code packages: read-only, so a clone lands in the pair.
        manifests: new Set([CRM, HR]),
        registry: {
            getObject: (name: string) => (name === LEDGER ? { name: LEDGER } : name === 'account' ? { name: 'account' } : undefined),
            getObjectOwner: (name: string) => (name === 'account' ? { packageId: CRM } : undefined),
            getPackage: (id: string) => packages[id],
            getAllPackages: () => Object.values(packages),
        },
        async find(object: string, options: any) {
            const rows = (tables[object] ?? []).filter((r) =>
                Object.entries(options?.where ?? {}).every(([k, v]) => {
                    if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`engine double: ${k} is not modelled`);
                    return (r[k] ?? null) === v;
                }));
            return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
        },
        async insert(object: string, data: Row) {
            writes.push(data);
            const row = { id: `act_${nextId++}`, ...data };
            (tables[object] ??= []).push(row);
            return row;
        },
        async update(object: string, data: Row, options?: any) {
            const dispatch = assertEngineUpdateDispatch(data, options);
            if (dispatch.kind !== 'by-id') throw new Error('engine double: only by-id updates are modelled');
            writes.push(data);
            const row = (tables[object] ?? []).find((r) => r.id === dispatch.id);
            if (row) Object.assign(row, data);
            return row;
        },
    };
    const manifests = Object.values(packages);
    bindSecurityCatalogReader(engine, createSecurityCatalogReader({
        registry: {
            getItem: (type: string, name: string) => (type === 'permission' && holders[name] ? setOf(name, holders[name][0]) : undefined),
            listItems: (type: string) => (type === 'permission'
                ? Object.entries(holders).flatMap(([name, held]) => held.map((p) => setOf(name, p)))
                : []),
            isPackageDisabled: () => false,
            packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? holders[name] ?? [] : []),
            getPackageScopedItem: (type: string, name: string, packageId: string) =>
                (type === 'permission' && (holders[name] ?? []).includes(packageId) ? setOf(name, packageId) : undefined),
            getEnvironmentScopedItem: () => undefined,
            getArtifactItem: () => undefined,
            getPackage: (id: string) => packages[id],
            getAllPackages: () => manifests,
        } as never,
        metadata: { get: () => undefined, list: () => [] },
    }));

    const saves: Array<{ name: string; item: Row; packageId?: string }> = [];
    const protocol = {
        async saveMetaItem(request: { name: string; item: Row; packageId?: string }) {
            saves.push(structuredClone(request));
            return { success: true };
        },
        async ensureCustomizationPackage({ basePackageId }: { basePackageId: string }) {
            const packageId = `${basePackageId}.custom`;
            const created = packages[packageId] === undefined;
            if (created) packages[packageId] = { manifest: { id: packageId, dependencies: { [basePackageId]: '^1' } } };
            return { basePackageId, packageId, namespace: `${basePackageId.split('.').pop()}_custom`, dependencyRange: '^1', created, writable: true };
        },
    };
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel as never), tables, writes, saves };
}

const OPERATOR = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', positions: [], systemPermissions: ['manage_metadata'] },
} as unknown as HttpProtocolContext);

type Harness = ReturnType<typeof boot>;
const flip = (h: Harness, name: string, query: Row = {}, body: unknown = { enabled: false }) =>
    h.dispatcher.handleSecurity(`/_activation/permission/${name}`, 'POST', body, query, OPERATOR()) as Promise<any>;
const clone = (h: Harness, source: string, query: Row = {}, body: unknown = { name: 'my_reader', label: 'My Reader' }) =>
    h.dispatcher.handleSecurity(`/permission-sets/${source}/clone`, 'POST', body, query, OPERATOR()) as Promise<any>;
const answer = (res: any) => ({
    status: res?.response?.status,
    code: res?.response?.body?.error?.code,
    message: String(res?.response?.body?.error?.message ?? ''),
    candidates: res?.response?.body?.error?.details?.candidates,
});
const BOTH = [{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }];

describe('the activation door — a permission set two packages hold', () => {
    it('no package named: 409 RESOURCE_CONFLICT naming both holders, structured; nothing written (BASE: 404)', async () => {
        const h = boot();
        const res = answer(await flip(h, TWO));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT', candidates: BOTH });
        expect(res.message).toContain(`package "${CRM}"`);
        expect(res.message).toContain(`package "${HR}"`);
        expect(h.writes).toEqual([]);
    });

    it('?package= a holder: switches exactly that package\'s set and writes that package\'s ledger row', async () => {
        const h = boot();
        expect(answer(await flip(h, TWO, { package: HR })).status).toBe(200);
        expect(h.tables[LEDGER]).toEqual([expect.objectContaining({ metadata_type: 'permission', name: TWO, package_id: HR, active: false })]);
        // Back on for HR updates that one row.
        expect(answer(await flip(h, TWO, { package: HR }, { enabled: true })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[HR, true]]);
    });

    /**
     * NOT a promise — the ledger store's own boundary, pinned so a change to it
     * is seen: `ObjectStoreMetadataActivationStore.setActive` addresses its row
     * by `(metadata_type, name)` (ADR-0150 red line 3; its docblock), because
     * every reader of a permission set's ledger row is still name-keyed. So a
     * later flip of CRM's set re-addresses the one row rather than writing a
     * second. Per-package rows need package-keyed ledger readers, which this
     * card does not change.
     */
    it('BOUNDARY — one ledger row per (type, name): a flip of the other holder re-addresses that row', async () => {
        const h = boot();
        await flip(h, TWO, { package: HR });
        expect(answer(await flip(h, TWO, { package: CRM })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[CRM, false]]);
    });

    it('?package= a package that does not hold it: 409 not-held-by-qualifier naming the holders; nothing written', async () => {
        const h = boot();
        const res = answer(await flip(h, TWO, { package: OTHER }));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT', candidates: BOTH });
        expect(res.message).toContain(OTHER);
        expect(h.writes).toEqual([]);
    });

    it('the query set is closed: an unknown name, a repeat and a blank value are 400 VALIDATION_ERROR, before any lookup', async () => {
        const h = boot();
        for (const query of [{ pkg: HR }, { package: [HR, CRM] }, { package: '  ' }]) {
            expect(answer(await flip(h, TWO, query)), JSON.stringify(query)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        }
        expect(answer(await flip(h, TWO, { pkg: HR })).message).toContain('pkg');
        // Every other type takes no query at all.
        expect(answer(await h.dispatcher.handleSecurity('/_activation/position/p', 'POST', { enabled: false }, { package: CRM }, OPERATOR())))
            .toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(h.writes).toEqual([]);
    });
});

describe('the activation door — CONTROL, one holder', () => {
    it('no package named: 200, the holder\'s ledger row, as before', async () => {
        const h = boot();
        expect(answer(await flip(h, ONE)).status).toBe(200);
        expect(h.tables[LEDGER]).toEqual([expect.objectContaining({ name: ONE, package_id: CRM, active: false })]);
    });

    it('?package= the holder answers the same; another package is 409; a name nothing holds stays 404', async () => {
        const h = boot();
        expect(answer(await flip(h, ONE, { package: CRM })).status).toBe(200);
        expect(answer(await flip(h, ONE, { package: HR }))).toMatchObject({ status: 409, candidates: [{ kind: 'package', packageId: CRM }] });
        expect(answer(await flip(h, 'nobody_holds_this')).status).toBe(404);
        expect(answer(await flip(h, 'nobody_holds_this', { package: CRM })).status).toBe(404);
    });
});

describe('the clone door — a source two packages hold', () => {
    it('no package named: 409 RESOURCE_CONFLICT naming both holders; nothing saved (BASE: 404)', async () => {
        const h = boot();
        expect(answer(await clone(h, TWO))).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT', candidates: BOTH });
        expect(h.saves).toEqual([]);
    });

    it('?package= names the SOURCE\'s package: exactly HR\'s set is copied, and lands in HR\'s pair', async () => {
        const h = boot();
        const res = await clone(h, TWO, { package: HR });
        expect(res?.response?.status, JSON.stringify(res?.response?.body)).toBe(200);
        expect(h.saves).toHaveLength(1);
        expect(h.saves[0]).toMatchObject({ name: 'my_reader', packageId: `${HR}.custom` });
        expect(h.saves[0].item).toMatchObject({ name: 'my_reader', label: 'My Reader', objects: { account: { allowRead: true } } });
    });

    it('?package= a non-holder: 409 naming the holders; nothing saved', async () => {
        const h = boot();
        expect(answer(await clone(h, TWO, { package: OTHER }))).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT', candidates: BOTH });
        expect(h.saves).toEqual([]);
    });

    it('a TARGET name two packages hold is taken: 409, nothing saved (BASE: saved)', async () => {
        const h = boot();
        const res = answer(await clone(h, ONE, {}, { name: TWO, label: 'Copy' }));
        expect([res.status, res.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(h.saves).toEqual([]);
    });

    it('the query set is closed: an unknown name is 400 VALIDATION_ERROR, before the body and any lookup', async () => {
        const h = boot();
        expect(answer(await clone(h, TWO, { source: HR }))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(answer(await clone(h, TWO, { package: [CRM, HR] }))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(h.saves).toEqual([]);
    });
});

describe('the clone door — CONTROL, one holder', () => {
    it('no package named: copied, landing in the holder\'s pair, as before', async () => {
        const h = boot();
        const res = await clone(h, ONE);
        expect(res?.response?.status, JSON.stringify(res?.response?.body)).toBe(200);
        expect(h.saves[0]).toMatchObject({ name: 'my_reader', packageId: `${CRM}.custom` });
    });

    it('a target name one package holds is taken, as before', async () => {
        const h = boot();
        expect(answer(await clone(h, ONE, {}, { name: ONE, label: 'Copy' })).status).toBe(409);
        expect(h.saves).toEqual([]);
    });
});
