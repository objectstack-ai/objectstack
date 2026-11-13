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
import { resolvePermissionSetAddress } from './catalog-activation.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const LEDGER = 'sys_metadata_activation';
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const OTHER = 'com.acme.other';
/** Held by CRM and HR. */
const TWO = 'shared_reader';
/** Held by CRM alone. */
const ONE = 'crm_sales_rep';
/** A position CRM holds: the type whose ledger store stays name-addressed. */
const POSITION = 'crm_rep';

type Row = Record<string, unknown>;
const setOf = (name: string, packageId: string) => ({
    name,
    label: `${name} (${packageId})`,
    objects: { account: { allowRead: true } },
    _packageId: packageId,
});
const holders: Record<string, string[]> = { [TWO]: [CRM, HR], [ONE]: [CRM] };
/** The overlay provenance sentinel: the `_packageId` of a set rehydrated from `sys_metadata`, which names no package. */
const SENTINEL = 'sys_metadata';
/** A set the environment authored: no package, or (`overlay`) the sentinel. */
const envSetOf = (name: string, spelling: 'plain' | 'overlay') => ({
    name,
    label: `${name} (environment)`,
    objects: { account: { allowRead: true } },
    ...(spelling === 'overlay' ? { _packageId: SENTINEL } : {}),
});

/**
 * `environment`: names the environment holds alone, and how its set is spelled;
 * `disabled`: holders whose package is disabled (the catalog does not serve
 * their set; the D3 rule still counts them).
 */
function boot(opts: { environment?: Record<string, 'plain' | 'overlay'>; disabled?: readonly string[] } = {}) {
    const environment = opts.environment ?? {};
    const disabled = new Set(opts.disabled ?? []);
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
            getItem: (type: string, name: string) => (type === 'permission' && holders[name]
                ? setOf(name, holders[name][0])
                : type === 'permission' && environment[name] ? envSetOf(name, environment[name])
                : type === 'position' && name === POSITION ? { name, label: name, _packageId: CRM } : undefined),
            listItems: (type: string) => (type === 'permission'
                ? [
                    ...Object.entries(holders).flatMap(([name, held]) => held.map((p) => setOf(name, p))),
                    ...Object.entries(environment).map(([name, spelling]) => envSetOf(name, spelling)),
                ]
                : type === 'position' ? [{ name: POSITION, label: POSITION, _packageId: CRM }] : []),
            isPackageDisabled: (packageId: string) => disabled.has(packageId),
            packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? holders[name] ?? [] : []),
            getPackageScopedItem: (type: string, name: string, packageId: string) =>
                (type === 'permission' && (holders[name] ?? []).includes(packageId) ? setOf(name, packageId) : undefined),
            getEnvironmentScopedItem: (type: string, name: string) =>
                (type === 'permission' && environment[name] ? envSetOf(name, environment[name]) : undefined),
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
     * [MF1, epic ruling on #32164] The permission ledger store is addressed by
     * `(package, name)` (`PERMISSION_LEDGER_ADDRESSING`): each holder keeps its
     * own row. BASE (this branch before the ruling, the name-addressed store):
     * the CRM flip re-addressed HR's row, `[[CRM, false]]`, and HR's set
     * granted again with both calls answering 200.
     */
    it('each holder keeps its own row: flipping CRM leaves HR\'s switched-off row untouched, and both stay independently switchable', async () => {
        const h = boot();
        expect(answer(await flip(h, TWO, { package: HR })).status).toBe(200);
        expect(answer(await flip(h, TWO, { package: CRM })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[HR, false], [CRM, false]]);
        // CRM back on: HR's row is not touched.
        expect(answer(await flip(h, TWO, { package: CRM }, { enabled: true })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[HR, false], [CRM, true]]);
        // HR back on, then off again: CRM's row is not touched.
        expect(answer(await flip(h, TWO, { package: HR }, { enabled: true })).status).toBe(200);
        expect(answer(await flip(h, TWO, { package: CRM })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[HR, true], [CRM, false]]);
    });

    it('a row naming no package keeps both holders off, so switching one on is 409 naming that row; nothing written (red line 1)', async () => {
        const h = boot();
        h.tables[LEDGER].push({ id: 'legacy', metadata_type: 'permission', name: TWO, package_id: null, active: false });
        const res = answer(await flip(h, TWO, { package: CRM }, { enabled: true }));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(res.message).toContain(`package "${CRM}"`);
        expect(res.message).toContain('naming no package');
        expect(h.writes).toEqual([]);
        // Switching it off writes CRM's own row; the package-less row is neither's and stays.
        expect(answer(await flip(h, TWO, { package: CRM })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[null, false], [CRM, false]]);
    });

    it('a row naming a package that no longer serves the name keeps both holders off too: switching one on is 409; nothing written', async () => {
        const h = boot();
        h.tables[LEDGER].push({ id: 'stale', metadata_type: 'permission', name: TWO, package_id: OTHER, active: false });
        const res = answer(await flip(h, TWO, { package: HR }, { enabled: true }));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(res.message).toContain(`naming package "${OTHER}"`);
        expect(h.writes).toEqual([]);
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

    it('[MF1, D8] a row naming no package is the one holder\'s switch: the flip takes it over, never a second row', async () => {
        const h = boot();
        h.tables[LEDGER].push({ id: 'legacy', metadata_type: 'permission', name: ONE, package_id: null, active: false });
        expect(answer(await flip(h, ONE, {}, { enabled: true })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['legacy', CRM, true]]);
    });

    it('[MF1, D8] a row naming a package that no longer serves the name is the one holder\'s switch too: re-addressed, as before', async () => {
        const h = boot();
        h.tables[LEDGER].push({ id: 'stale', metadata_type: 'permission', name: ONE, package_id: OTHER, active: false });
        expect(answer(await flip(h, ONE, {}, { enabled: true })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['stale', CRM, true]]);
    });

    // BASE (the name-addressed store): the first row found was re-addressed and
    // the other row stayed, so the answer hung on the order the rows came back.
    it('[MF1] beside the holder\'s own row, a row naming no package keeps it off: switching it on is 409 naming that row; nothing written', async () => {
        const h = boot();
        h.tables[LEDGER].push(
            { id: 'own', metadata_type: 'permission', name: ONE, package_id: CRM, active: false },
            { id: 'legacy', metadata_type: 'permission', name: ONE, package_id: null, active: false },
        );
        const res = answer(await flip(h, ONE, {}, { enabled: true }));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(res.message).toContain('naming no package, which is read by the name alone');
        expect(h.writes).toEqual([]);
    });

    it('[MF1] every other type keeps the name-addressed store: a position row is re-attributed by name, as before', async () => {
        const h = boot();
        h.tables[LEDGER].push({ id: 'pos', metadata_type: 'position', name: POSITION, package_id: OTHER, active: true });
        expect(answer(await h.dispatcher.handleSecurity(`/_activation/position/${POSITION}`, 'POST', { enabled: false }, {}, OPERATOR())).status)
            .toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.id, r.metadata_type, r.package_id, r.active])).toEqual([['pos', 'position', CRM, false]]);
    });

    it('?package= the holder answers the same; another package is 409; a name nothing holds stays 404', async () => {
        const h = boot();
        expect(answer(await flip(h, ONE, { package: CRM })).status).toBe(200);
        expect(answer(await flip(h, ONE, { package: HR }))).toMatchObject({ status: 409, candidates: [{ kind: 'package', packageId: CRM }] });
        expect(answer(await flip(h, 'nobody_holds_this')).status).toBe(404);
        expect(answer(await flip(h, 'nobody_holds_this', { package: CRM })).status).toBe(404);
    });
});

/**
 * [#32306 red-line review E1, contract review 6813617327 must-fix 1] A set the
 * ENVIRONMENT holds alone is a one-holder answer too: its only ledger row is
 * its switch, whatever package that row names — one that no longer serves the
 * name, or the overlay provenance sentinel `main`'s name-addressed store wrote
 * for a set rehydrated from `sys_metadata`. The flip takes that row over.
 *
 * BASE (`main`, the name-addressed store): `200`, the one row re-addressed by
 * name to the entry's `_packageId` as stored (the sentinel for an overlay
 * entry, none for a plain one). Before this fix, this branch answered the
 * enable `409` ("Delete that row") and wrote a second row on a disable.
 */
describe('[E1] the activation door — CONTROL, the environment is the one holder', () => {
    const ENV = 'env_auditor';
    describe.each(['plain', 'overlay'] as const)('the environment\'s set spelled %s', (spelling) => {
        const h0 = () => boot({ environment: { [ENV]: spelling } });

        it('a row naming a package that no longer serves the name is its switch: switching on takes it over, 200', async () => {
            const h = h0();
            h.tables[LEDGER].push({ id: 'stale', metadata_type: 'permission', name: ENV, package_id: OTHER, active: false });
            expect(answer(await flip(h, ENV, {}, { enabled: true })).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['stale', null, true]]);
        });

        it('a row stamped with the overlay provenance sentinel is its switch: switching on takes it over, 200', async () => {
            const h = h0();
            h.tables[LEDGER].push({ id: 'sentinel', metadata_type: 'permission', name: ENV, package_id: SENTINEL, active: false });
            expect(answer(await flip(h, ENV, {}, { enabled: true })).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['sentinel', null, true]]);
        });

        it('switching off over such a row re-addresses that one row, never a second', async () => {
            const h = h0();
            h.tables[LEDGER].push({ id: 'stale', metadata_type: 'permission', name: ENV, package_id: OTHER, active: true });
            expect(answer(await flip(h, ENV)).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['stale', null, false]]);
        });

        it('CONTROL: no row: the flip writes the environment\'s own row, naming no package', async () => {
            const h = h0();
            expect(answer(await flip(h, ENV)).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.package_id ?? null, r.active])).toEqual([[null, false]]);
        });
    });
});

/**
 * [Epic read 6817314015, S1] A package and the ENVIRONMENT hold one name: the name alone is the environment's set
 * (D3, a caller with no package), so a row stamped with the overlay sentinel is the environment's own switch.
 * BASE (ec39bd8e5): matched on its raw `package_id`, it was not; switching on answered 409 ("switches off every
 * holder", false), and switching off wrote a second row.
 */
describe('[S1] the activation door — a package and the environment hold one name', () => {
    describe.each(['plain', 'overlay'] as const)('the environment\'s set spelled %s', (spelling) => {
        const h0 = () => boot({ environment: { [ONE]: spelling } });

        it('a sentinel row is the environment\'s switch: switching the environment\'s set on takes it over, 200; the package\'s set is untouched', async () => {
            const h = h0();
            h.tables[LEDGER].push({ id: 'sentinel', metadata_type: 'permission', name: ONE, package_id: SENTINEL, active: false });
            expect(answer(await flip(h, ONE, {}, { enabled: true })).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['sentinel', null, true]]);
        });

        it('switching it off over a sentinel row re-addresses that one row, never a second; the package\'s own row stays as it was', async () => {
            const h = h0();
            h.tables[LEDGER].push(
                { id: 'sentinel', metadata_type: 'permission', name: ONE, package_id: SENTINEL, active: true },
                { id: 'crm', metadata_type: 'permission', name: ONE, package_id: CRM, active: false },
            );
            expect(answer(await flip(h, ONE)).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id, r.active])).toEqual([['sentinel', null, false], ['crm', CRM, false]]);
        });

        it('CONTROL: ?package= the package switches its own row; the environment\'s sentinel row is untouched', async () => {
            const h = h0();
            h.tables[LEDGER].push({ id: 'sentinel', metadata_type: 'permission', name: ONE, package_id: SENTINEL, active: false });
            expect(answer(await flip(h, ONE, { package: CRM }, { enabled: true })).status).toBe(200);
            expect(h.tables[LEDGER].map((r) => [r.id, r.package_id ?? null, r.active])).toEqual([
                ['sentinel', SENTINEL, false],
                [expect.any(String), CRM, true],
            ]);
        });

        it('[S3] beside the environment\'s own row, a switched-off sentinel row keeps it off: 409 reading that row by the name alone, never "every holder"; nothing written', async () => {
            const h = h0();
            h.tables[LEDGER].push(
                { id: 'env', metadata_type: 'permission', name: ONE, package_id: null, active: false },
                { id: 'sentinel', metadata_type: 'permission', name: ONE, package_id: SENTINEL, active: false },
            );
            const res = answer(await flip(h, ONE, {}, { enabled: true }));
            expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(res.message).toContain('one naming no package, which is read by the name alone (ADR-0150 D3)');
            expect(h.writes).toEqual([]);
        });
    });
});

/**
 * [Contract review 6813617327, should-fix 2] A package that holds the name but
 * is DISABLED: the catalog does not serve its set, and the D3 rule still counts
 * it as a holder. So the activation door counts it too: a row naming no
 * package is every holder's switch while the rule refuses the bare name, and
 * switching the served holder on beside it is `409`, never a take-over that
 * would leave the disabled holder's set on once its package is enabled again.
 * Before this fix the door counted the served holder alone and took the row
 * over (`200`).
 */
describe('[should-fix 2] a disabled package still holds the name, at the activation door', () => {
    it('a row naming no package keeps the served holder off: switching it on is 409 naming that row; nothing written', async () => {
        const h = boot({ disabled: [HR] });
        h.tables[LEDGER].push({ id: 'legacy', metadata_type: 'permission', name: TWO, package_id: null, active: false });
        const res = answer(await flip(h, TWO, { package: CRM }, { enabled: true }));
        expect(res).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(res.message).toContain('one naming no package, which switches off every holder of the name while the name alone is refused (ADR-0150 D3: more than one package holds it, and the environment does not)');
        expect(h.writes).toEqual([]);
    });

    it('the bare name is refused naming both holders; ?package= the disabled one holds nothing the door can switch: 409 naming the served holder', async () => {
        const h = boot({ disabled: [HR] });
        expect(answer(await flip(h, TWO))).toMatchObject({ status: 409, candidates: BOTH });
        expect(answer(await flip(h, TWO, { package: HR }))).toMatchObject({ status: 409, candidates: [{ kind: 'package', packageId: CRM }] });
        expect(h.writes).toEqual([]);
    });

    it('CONTROL: the served holder\'s own flip with no other row is 200, its own row', async () => {
        const h = boot({ disabled: [HR] });
        expect(answer(await flip(h, TWO, { package: CRM })).status).toBe(200);
        expect(h.tables[LEDGER].map((r) => [r.package_id, r.active])).toEqual([[CRM, false]]);
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

describe('[SF7] the overlay provenance sentinel is no package, at both doors\' address read', () => {
    const OVERLAID = 'overlaid_auditor';
    const SENTINEL = 'sys_metadata';
    const reader = () => createSecurityCatalogReader({
        registry: {
            getItem: (type: string, name: string) => (type === 'permission' && name === OVERLAID ? setOf(OVERLAID, SENTINEL) : undefined),
            listItems: (type: string) => (type === 'permission' ? [setOf(OVERLAID, SENTINEL)] : []),
            isPackageDisabled: () => false,
            getPackage: () => undefined,
            getAllPackages: () => [],
        } as never,
        metadata: { get: () => undefined, list: () => [] },
    });

    it('?package= the sentinel holds nothing: refused not-held-by-qualifier, the holder named as the environment; CONTROL: the bare name resolves', async () => {
        expect(await resolvePermissionSetAddress(reader(), OVERLAID, SENTINEL)).toMatchObject({
            status: 'refused',
            refusal: { reason: 'not-held-by-qualifier', candidates: [{ kind: 'environment' }] },
        });
        expect(await resolvePermissionSetAddress(reader(), OVERLAID, OTHER))
            .toMatchObject({ status: 'refused', refusal: { candidates: [{ kind: 'environment' }] } });
        expect(await resolvePermissionSetAddress(reader(), OVERLAID)).toMatchObject({ status: 'resolved', entry: { name: OVERLAID } });
    });
});
