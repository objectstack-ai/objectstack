// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §6 wall 3] The marketplace door's access upgrade refusal: a
 * re-install over an installed package that would un-make an access choice
 * made in this system is refused `409 ACCESS_UPGRADE_CONFIRMATION_REQUIRED`,
 * before any write, until the same call carries the finding set's token.
 *
 * The door runs here against the security plugin's REAL check
 * (`createAccessUpgradeCheck`, aliased to this checkout's source), registered
 * under the service name the door asks for. The check reads an in-memory
 * access state: a registry holding version 1 of the vendor package as the boot
 * registered it, the activation ledger, the customer's own permission set and
 * the declared sharing rules. So each pin below is the comparison's real
 * answer, delivered through the door's real refusal.
 *
 * Pinned, for each of the four access types (permission set, position,
 * sharing rule, capability):
 *
 * - `single`: the administrator (a `manage_metadata` holder) is refused with
 *   the finding, and nothing is registered or written;
 * - walled (`isolated`, `group`): the platform operator is refused with the
 *   finding; a tenant administrator is refused by the D12 wall first (403) and
 *   is shown no finding — the check never runs for them;
 * - CONTROL: the same upgrade that keeps the name installs unchanged (200).
 *
 * And the confirmation: the token installs and is recorded; a stale token and
 * a bare `true` are refused again; a fresh install is never checked; a
 * finding that predates the upgrade does not block it; a check that could not
 * read answers 503 and writes nothing; a composition without the check
 * installs and says so.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// [#21321] An install binds the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top — never inside a clocked `it`.
import '@objectstack/runtime';
import { ACCESS_UPGRADE_CHECK_SERVICE, createAccessUpgradeCheck } from '@objectstack/plugin-security';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, unknown>;

const VENDOR = 'com.acme.access';
const INSTALLER = 'usr_installer';
const POSTURE_ENV = 'OS_TENANCY_POSTURE';

// ── The vendor package, version 1 and the upgrades ──────────────────────────

interface Names { set: string; position: string; rule: string; capability: string | null }
const V1: Names = { set: 'acme_sales_rep', position: 'acme_lead', rule: 'acme_share_open', capability: 'acme.export' };

function vendorBody(version: string, names: Names): Row {
    return {
        id: VENDOR,
        namespace: 'acme',
        version,
        objects: [{ name: 'acme_deal', label: 'Deal', fields: { amount: { type: 'number' }, stage: { type: 'text' } } }],
        capabilities: names.capability ? [{ name: names.capability, label: 'Export deals' }] : [],
        permissions: [{
            name: names.set,
            label: 'Sales rep',
            objects: { acme_deal: { allowRead: true } },
            ...(names.capability ? { systemPermissions: [names.capability] } : {}),
        }],
        positions: [{ name: names.position, label: 'Lead', permissionSets: [names.set] }],
        sharingRules: [{ name: names.rule, object: 'acme_deal', type: 'criteria', criteria: { stage: 'open' }, accessLevel: 'read' }],
    };
}

// ── The access state the check reads ────────────────────────────────────────

interface AccessState {
    ledger: Row[];
    customerSets: Row[];
    failLedger?: boolean;
}

/** The registry as the boot left it with version 1 installed, and the engine the check reads through. */
function accessEngine(state: AccessState, installed: Row) {
    const items = new Map<string, Map<string, Row>>();
    const put = (type: string, def: Row) => {
        if (!items.has(type)) items.set(type, new Map());
        items.get(type)!.set(def.name as string, { ...def, _packageId: VENDOR });
    };
    for (const def of installed.permissions as Row[]) put('permission', def);
    for (const def of installed.positions as Row[]) put('position', def);
    for (const def of installed.capabilities as Row[]) put('capability', def);
    // The registry injects system fields into every object it registers.
    const objects = new Map<string, Row>();
    for (const object of installed.objects as Row[]) {
        objects.set(object.name as string, {
            ...object,
            fields: { id: {}, owner: {}, organization_id: {}, created_at: {}, ...(object.fields as Row) },
        });
    }
    objects.set('sys_metadata_activation', { name: 'sys_metadata_activation', fields: {} });
    objects.set('sys_sharing_rule', { name: 'sys_sharing_rule', fields: {} });
    const registry = {
        getItem: (type: string, name: string) => items.get(type)?.get(name),
        listItems: (type: string) => [...(items.get(type)?.values() ?? [])],
        isPackageDisabled: () => false,
        getPackage: (id: string) => (id === VENDOR ? { manifest: installed } : undefined),
    };
    const tables: Record<string, Row[]> = { sys_metadata_activation: state.ledger, sys_sharing_rule: [] };
    return {
        registry,
        getObject: (name: string) => objects.get(name),
        find: async (object: string, options: { limit?: number; offset?: number }) => {
            if (object === 'sys_metadata_activation' && state.failLedger) throw new Error('ledger store offline');
            const rows = tables[object] ?? [];
            const offset = options?.offset ?? 0;
            return rows.slice(offset, offset + (options?.limit ?? rows.length));
        },
    };
}

function accessCheck(state: AccessState, installed: Row) {
    const engine = accessEngine(state, installed);
    const declared = (installed.sharingRules as Row[]).map((r) => ({ name: r.name as string, object: r.object as string, packageId: VENDOR }));
    const check = createAccessUpgradeCheck({
        engine: () => engine,
        metadata: () => ({
            get: async (type: string, name: string) => (type === 'permission' ? state.customerSets.find((s) => s.name === name) : undefined),
            list: async (type: string) => (type === 'permission' ? state.customerSets : []),
        }),
        sharingRules: () => ({ listDeclaredRules: async () => declared }),
    });
    return { check: vi.fn(check.check) };
}

// ── The door ────────────────────────────────────────────────────────────────

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
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

let dir: string;
let savedPosture: string | undefined;
let restoreOwner: (() => void) | undefined;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-access-'));
    savedPosture = process.env[POSTURE_ENV];
    delete process.env[POSTURE_ENV];
});
afterEach(() => {
    restoreOwner?.();
    restoreOwner = undefined;
    rmSync(dir, { recursive: true, force: true });
    if (savedPosture === undefined) delete process.env[POSTURE_ENV];
    else process.env[POSTURE_ENV] = savedPosture;
    vi.restoreAllMocks();
});

type Caller = 'administrator' | 'operator' | 'tenant-administrator';

/**
 * Mount the door with version 1 already installed through it (so the next
 * install is a re-install), then switch to `posture` and `caller`.
 */
async function mountWithV1(
    state: AccessState,
    options: { posture?: 'single' | 'isolated' | 'group'; caller?: Caller; withCheck?: boolean } = {},
) {
    const installed = vendorBody('1.0.0', V1);
    const { check } = accessCheck(state, installed);
    const register = vi.fn();
    const rawApp = makeRawApp();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({ syncSchemas: vi.fn(async () => undefined) }, INSTALLER),
        ...(options.withCheck === false ? {} : { [ACCESS_UPGRADE_CHECK_SERVICE]: { check } }),
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

    const first = await install(makeC({ manifest: installed }));
    expect(first.status).toBe(200);
    expect(check).not.toHaveBeenCalled(); // a fresh install has no choice of the customer's to un-make
    register.mockClear();
    logger.warn.mockClear();

    const posture = options.posture ?? 'single';
    if (posture !== 'single') process.env[POSTURE_ENV] = posture;
    if (options.caller !== 'tenant-administrator') restoreOwner = declareInstallerPlatformOwner(INSTALLER);
    return { install, register, check, logger };
}

const ledgerVersion = (): string | undefined => new LocalManifestSource(dir).read(VENDOR).entry?.version;

// ── The four types ──────────────────────────────────────────────────────────

interface TypeCase {
    type: string;
    state: () => AccessState;
    /** The upgrade that would un-make the choice. */
    upgrade: Names;
    /** What the refusal names. */
    expected: Row;
}

const TYPES: TypeCase[] = [
    {
        type: 'permission set',
        state: () => ({ ledger: [{ id: 'a1', metadata_type: 'permission', name: V1.set, package_id: VENDOR, active: false }], customerSets: [] }),
        upgrade: { ...V1, set: 'acme_sales_representative' },
        expected: {
            kind: 're-enablement', type: 'permission', name: V1.set, packageId: VENDOR,
            candidates: [{ name: 'acme_sales_representative', positions: [V1.position] }],
        },
    },
    {
        type: 'position',
        state: () => ({ ledger: [{ id: 'a1', metadata_type: 'position', name: V1.position, package_id: VENDOR, active: false }], customerSets: [] }),
        upgrade: { ...V1, position: 'acme_team_lead' },
        expected: {
            kind: 're-enablement', type: 'position', name: V1.position, packageId: VENDOR,
            candidates: [{ name: 'acme_team_lead', positions: [] }],
        },
    },
    {
        type: 'sharing rule',
        state: () => ({ ledger: [{ id: 'a1', metadata_type: 'sharing_rule', name: V1.rule, package_id: VENDOR, active: false }], customerSets: [] }),
        upgrade: { ...V1, rule: 'acme_share_open_deals' },
        expected: {
            kind: 're-enablement', type: 'sharing_rule', name: V1.rule, packageId: VENDOR,
            candidates: [{ name: 'acme_share_open_deals', positions: [] }],
        },
    },
    {
        type: 'capability',
        state: () => ({
            ledger: [],
            customerSets: [{ name: 'cust_exporter', label: 'Exporter', _provenance: 'org', objects: {}, systemPermissions: [V1.capability] }],
        }),
        upgrade: { ...V1, capability: null },
        expected: {
            kind: 'broken-reference', type: 'permission', name: 'cust_exporter',
            missing: [{ kind: 'capability', name: V1.capability }],
        },
    },
];

describe('[ADR-0126 §6 wall 3] install-local refuses an upgrade that would un-make an access choice', () => {
    for (const t of TYPES) {
        describe(t.type, () => {
            it('single: the administrator is refused 409 with the finding, and nothing is registered or written', async () => {
                const { install, register, check } = await mountWithV1(t.state());
                const res = await install(makeC({ manifest: vendorBody('2.0.0', t.upgrade) }));
                expect(res.status).toBe(409);
                expect(res.payload.error.code).toBe('ACCESS_UPGRADE_CONFIRMATION_REQUIRED');
                const findings = res.payload.error.details.findings;
                expect(findings).toHaveLength(1);
                expect(findings[0]).toMatchObject(t.expected);
                expect(typeof findings[0].describe).toBe('string');
                expect(res.payload.error.details.confirmWith.body).toEqual({ confirmAccessUpgrade: res.payload.error.details.findingSet });
                expect(check).toHaveBeenCalledTimes(1);
                expect(register).not.toHaveBeenCalled();
                expect(ledgerVersion()).toBe('1.0.0');
            });

            it('single CONTROL: the upgrade that keeps the name installs unchanged', async () => {
                const { install, register, check } = await mountWithV1(t.state());
                const res = await install(makeC({ manifest: vendorBody('2.0.0', V1) }));
                expect(res.status).toBe(200);
                expect(res.payload.data.upgradedFrom).toBe('previous-marketplace-version');
                expect(check).toHaveBeenCalledTimes(1);
                expect(register).toHaveBeenCalledTimes(1);
                expect(ledgerVersion()).toBe('2.0.0');
                expect(new LocalManifestSource(dir).read(VENDOR).entry?.accessUpgradeConfirmation).toBeUndefined();
            });

            for (const posture of ['isolated', 'group'] as const) {
                it(`${posture}: the operator is refused 409 with the finding`, async () => {
                    const { install, register } = await mountWithV1(t.state(), { posture, caller: 'operator' });
                    const res = await install(makeC({ manifest: vendorBody('2.0.0', t.upgrade) }));
                    expect(res.status).toBe(409);
                    expect(res.payload.error.code).toBe('ACCESS_UPGRADE_CONFIRMATION_REQUIRED');
                    expect(res.payload.error.details.findings[0]).toMatchObject(t.expected);
                    expect(register).not.toHaveBeenCalled();
                    expect(ledgerVersion()).toBe('1.0.0');
                });

                it(`${posture}: a tenant administrator is refused by the wall first, and shown no finding`, async () => {
                    const { install, register, check } = await mountWithV1(t.state(), { posture, caller: 'tenant-administrator' });
                    const res = await install(makeC({ manifest: vendorBody('2.0.0', t.upgrade) }));
                    expect(res.status).toBe(403);
                    expect(res.payload.error.code).toBe('FORBIDDEN');
                    expect(res.payload.error.details?.findings).toBeUndefined();
                    expect(check).not.toHaveBeenCalled();
                    expect(register).not.toHaveBeenCalled();
                });
            }

            it('isolated CONTROL: the operator installs the upgrade that keeps the name', async () => {
                const { install, register } = await mountWithV1(t.state(), { posture: 'isolated', caller: 'operator' });
                const res = await install(makeC({ manifest: vendorBody('2.0.0', V1) }));
                expect(res.status).toBe(200);
                expect(register).toHaveBeenCalledTimes(1);
                expect(ledgerVersion()).toBe('2.0.0');
            });
        });
    }
});

describe('[ADR-0126 §6 wall 3] the confirmation is the finding set\'s token, on the same call', () => {
    const renameSet = TYPES[0];

    it('the token installs the upgrade, and the ledger entry records who confirmed which set', async () => {
        const { install, register, logger } = await mountWithV1(renameSet.state());
        const upgrade = vendorBody('2.0.0', renameSet.upgrade);
        const refused = await install(makeC({ manifest: upgrade }));
        const findingSet = refused.payload.error.details.findingSet;
        expect(findingSet).toMatch(/^security\.access_upgrade:[0-9a-f]{32}$/);

        const res = await install(makeC({ manifest: upgrade, confirmAccessUpgrade: findingSet }));
        expect(res.status).toBe(200);
        expect(register).toHaveBeenCalledTimes(1);
        const entry = new LocalManifestSource(dir).read(VENDOR).entry;
        expect(entry?.version).toBe('2.0.0');
        expect(entry?.accessUpgradeConfirmation).toMatchObject({ findingSet, confirmedBy: INSTALLER });
        expect(logger.warn.mock.calls.some(([m]: any[]) => String(m).includes(`confirmed by ${INSTALLER}`))).toBe(true);
    });

    it('a bare `true` confirms nothing', async () => {
        const { install, register } = await mountWithV1(renameSet.state());
        const res = await install(makeC({ manifest: vendorBody('2.0.0', renameSet.upgrade), confirmAccessUpgrade: true }));
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toContain('`true` confirms nothing');
        expect(register).not.toHaveBeenCalled();
    });

    it('a stale token — the findings changed since it was issued — is refused again with the fresh set', async () => {
        const { install, register } = await mountWithV1(renameSet.state());
        const refused = await install(makeC({ manifest: vendorBody('2.0.0', renameSet.upgrade) }));
        const stale = refused.payload.error.details.findingSet;
        // A different upgrade: the set is renamed to another name.
        const res = await install(makeC({ manifest: vendorBody('2.0.1', { ...V1, set: 'acme_sales_agent' }), confirmAccessUpgrade: stale }));
        expect(res.status).toBe(409);
        expect(res.payload.error.details.findingSet).not.toBe(stale);
        expect(res.payload.error.details.findings[0].candidates).toEqual([{ name: 'acme_sales_agent', positions: [V1.position] }]);
        expect(register).not.toHaveBeenCalled();
    });
});

describe('[ADR-0126 §6 wall 3] what the door refuses on, and what it does not', () => {
    it('a finding that predates the upgrade does not block it: only what the upgrade creates is refused', async () => {
        // A switch-off whose name nothing ships any more, left by some other
        // package long ago: the boot report raises it; this upgrade did not make it.
        const state: AccessState = {
            ledger: [{ id: 'old', metadata_type: 'permission', name: 'gone_set', package_id: 'com.other.pkg', active: false }],
            customerSets: [],
        };
        const { install, register } = await mountWithV1(state);
        const res = await install(makeC({ manifest: vendorBody('2.0.0', V1) }));
        expect(res.status).toBe(200);
        expect(register).toHaveBeenCalledTimes(1);
    });

    it('a check that could not read refuses 503 and writes nothing — an unread store is never "no finding"', async () => {
        const state = { ...TYPES[0].state(), failLedger: false };
        const { install, register } = await mountWithV1(state);
        state.failLedger = true;
        const res = await install(makeC({ manifest: vendorBody('2.0.0', V1) }));
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(res.payload.error.details.reading).toBe('sys_metadata_activation');
        expect(register).not.toHaveBeenCalled();
        expect(ledgerVersion()).toBe('1.0.0');
    });

    it('a composition with no access check installs the upgrade and says no check ran', async () => {
        const { install, register, logger } = await mountWithV1(TYPES[0].state(), { withCheck: false });
        const res = await install(makeC({ manifest: vendorBody('2.0.0', TYPES[0].upgrade) }));
        expect(res.status).toBe(200);
        expect(register).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls.some(([m]: any[]) => String(m).includes('no access upgrade check ran'))).toBe(true);
    });
});
