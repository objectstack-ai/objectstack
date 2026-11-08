// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 Q3, #30884] The marketplace door's dry run: `dryRun: true`
 * answers the package upgrade plan of the installed version (its ledger
 * entry) against the incoming one, read from the `manifest` service's
 * `planUpgrade`, and writes nothing — no registration, no schema sync, no
 * ledger change.
 *
 * `planUpgrade` here is the comparison the real service runs
 * (`comparePackageVersions`, each side folded by `resolveStackCollection`)
 * with an empty environment reading: the readings themselves are pinned on
 * the real engine in `@objectstack/objectql`'s
 * `package-upgrade-environment.test.ts`. What this file pins is the door: what
 * it hands the service, what it answers, and that it writes nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
// [#21321] An install binds the package's handlers through
// `@objectstack/runtime` (a lazy `import()` inside the plugin). Its first load
// is paid here, at module top — never inside a clocked `it`.
import '@objectstack/runtime';
import { resolveStackCollection } from '@objectstack/core';
import { comparePackageVersions } from '@objectstack/metadata-core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, unknown>;

const VENDOR = 'com.acme.leads';
const INSTALLER = 'usr_installer';

function vendorBody(version: string, fields: Row, data: Row[] = []): Row {
    return {
        id: VENDOR,
        namespace: 'acme',
        version,
        objects: [{ name: 'acme_lead', label: 'Lead', fields }],
        ...(data.length > 0 ? { data } : {}),
    };
}

const V1 = vendorBody('1.0.0', { company: { type: 'text' } }, [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', company: 'Acme' }] }]);
const V2 = vendorBody('2.0.0', { account_name: { type: 'text' } }, [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', account_name: 'Acme' }] }]);

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
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-upgrade-plan-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const fold = (artifact: unknown) => ({ objects: resolveStackCollection(artifact, 'objects'), data: resolveStackCollection(artifact, 'data') });

async function mount(options: { installed?: Row; planUpgrade?: false; columns?: Row[]; registryPackages?: Row[] } = {}) {
    const register = vi.fn();
    const syncSchemas = vi.fn(async () => undefined);
    const planUpgrade = vi.fn(async (installed: unknown, incoming: unknown) => ({
        plan: comparePackageVersions(fold(installed), fold(incoming)),
        environment: { columns: options.columns ?? [], removedObjects: [], seeds: [] },
    }));
    const rawApp = makeRawApp();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, any> = {
        manifest: options.planUpgrade === false ? { register } : { register, planUpgrade },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas,
            ...(options.registryPackages ? { registry: { getAllPackages: () => options.registryPackages } } : {}),
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
    return { install, register, syncSchemas, planUpgrade };
}

/** Every ledger file and its bytes. */
const ledgerFiles = (): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

describe('dryRun: true answers the upgrade plan and writes nothing', () => {
    it('a re-install: the installed ledger body against the incoming one; registry, schema and ledger untouched', async () => {
        const door = await mount({ installed: V1 });
        const before = ledgerFiles();

        const res = await door.install(makeC({ manifest: V2, dryRun: true }));

        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ dryRun: true, manifestId: VENDOR, version: '2.0.0', installedVersion: '1.0.0' });
        expect(res.payload.data.plan.suspectedRenames).toEqual([
            { object: 'acme_lead', field: 'company', type: 'text', candidates: [{ field: 'account_name', type: 'text' }] },
        ]);
        expect(res.payload.data.plan.seeds.changed).toEqual([expect.objectContaining({ key: 'acme_lead', mode: 'upsert', changed: ['records'] })]);
        expect(res.payload.data.environment).toEqual({ columns: [], removedObjects: [], seeds: [] });
        expect(res.payload.data.message).toMatch(/from 1\.0\.0 to 2\.0\.0\. Nothing was installed or written\./);

        // The service was handed the installed version from the ledger and the incoming one.
        const [installed, incoming] = door.planUpgrade.mock.calls[0];
        expect(resolveStackCollection(installed, 'objects')).toEqual(V1.objects);
        expect(resolveStackCollection(incoming, 'objects')).toEqual(V2.objects);

        // Nothing written: no registration, no schema sync, the ledger byte for byte.
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
        expect(new LocalManifestSource(dir).read(VENDOR).entry?.version).toBe('1.0.0');
    });

    it('a package not installed here: the plan lists what it adds, and no ledger entry appears', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: true }));
        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ dryRun: true, installedVersion: null });
        expect(res.payload.data.plan.objects.added).toEqual(['acme_lead']);
        expect(res.payload.data.message).toMatch(/is not installed here/);
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });

    it('CONTROL: an upgrade without dryRun installs, and asks no plan when nothing needs confirming', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', { company: { type: 'text' }, region: { type: 'text' } }) }));
        expect(res.status).toBe(200);
        expect(door.register).toHaveBeenCalledTimes(1);
        expect(door.planUpgrade).not.toHaveBeenCalled();
        expect(new LocalManifestSource(dir).read(VENDOR).entry?.version).toBe('2.0.0');
    });

    it('a runtime whose manifest service answers no planUpgrade answers 503, never an empty plan', async () => {
        const door = await mount({ installed: V1, planUpgrade: false });
        const before = ledgerFiles();
        const res = await door.install(makeC({ manifest: V2, dryRun: true }));
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(res.payload.error.message).toMatch(/planUpgrade/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });
});

describe('a dryRun this door cannot honour is refused, never run as an install', () => {
    it('a dryRun that is not a boolean', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: 'yes' }));
        expect(res.status).toBe(400);
        expect(res.payload.error).toMatchObject({ code: 'INVALID_REQUEST' });
        expect(res.payload.error.message).toMatch(/`dryRun` must be true or false/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });

    it('a dry run of an unmanaged install', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V1, dryRun: true, installMode: 'unmanaged' }));
        expect(res.status).toBe(400);
        expect(res.payload.error.message).toMatch(/an `unmanaged` install is a copy that follows no upgrade/);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});
    });
});

/**
 * [epic cloud#3652 Q3, #30884 · ruling record 6709061297] Step 2c′: a managed
 * RE-install whose plan carries an undeclared suspected rename or a
 * `needs_confirm` / `destructive` type change is refused 409 until the same
 * call carries the finding set's token; a declared rename is refused 501
 * until this runtime can carry the column; everything else installs as
 * before.
 */
describe('step 2c′: the schema upgrade verdict on a managed re-install', () => {
    const TOKEN = /^schema-upgrade:[0-9a-f]{32}$/;
    const entry = () => new LocalManifestSource(dir).read(VENDOR).entry;

    it('an undeclared suspected rename answers 409 with its findings and token, and writes nothing', async () => {
        const door = await mount({ installed: V1, columns: [{ object: 'acme_lead', field: 'company', reasons: ['suspected_rename'], rows: 3 }] });
        const before = ledgerFiles();

        const res = await door.install(makeC({ manifest: V2 }));

        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('SCHEMA_UPGRADE_CONFIRMATION_REQUIRED');
        const { details } = res.payload.error;
        expect(details.findingSet).toMatch(TOKEN);
        expect(details.findings).toEqual([expect.objectContaining({
            kind: 'suspected_rename',
            object: 'acme_lead',
            field: 'company',
            type: 'text',
            candidates: [{ field: 'account_name', type: 'text' }],
            rows: 3,
        })]);
        expect(details.confirmWith.body).toEqual({ confirmSchemaUpgrade: details.findingSet });
        // Both ways forward are named.
        expect(res.payload.error.message).toMatch(/`renamedFrom`/);
        expect(res.payload.error.message).toContain(`"confirmSchemaUpgrade": "${details.findingSet}"`);
        // Nothing written.
        expect(door.register).not.toHaveBeenCalled();
        expect(door.syncSchemas).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });

    it('the same call with the token installs, and the ledger entry records the confirmation', async () => {
        const door = await mount({ installed: V1 });
        const refused = await door.install(makeC({ manifest: V2 }));
        const findingSet = refused.payload.error.details.findingSet;

        const res = await door.install(makeC({ manifest: V2, confirmSchemaUpgrade: findingSet }));

        expect(res.status).toBe(200);
        expect(door.register).toHaveBeenCalledTimes(1);
        expect(entry()?.version).toBe('2.0.0');
        expect(entry()?.schemaUpgradeConfirmation).toEqual({ findingSet, confirmedBy: INSTALLER, confirmedAt: expect.any(String) });
    });

    it('a different finding set refuses the old token, naming the fresh one', async () => {
        const door = await mount({ installed: V1 });
        const first = await door.install(makeC({ manifest: V2 }));
        const oldToken = first.payload.error.details.findingSet;
        const other = vendorBody('2.0.0', { account_title: { type: 'text' } });

        const res = await door.install(makeC({ manifest: other, confirmSchemaUpgrade: oldToken }));

        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('SCHEMA_UPGRADE_CONFIRMATION_REQUIRED');
        expect(res.payload.error.details.findingSet).toMatch(TOKEN);
        expect(res.payload.error.details.findingSet).not.toBe(oldToken);
        expect(res.payload.error.message).toMatch(/does not confirm these findings/);
        expect(door.register).not.toHaveBeenCalled();
        expect(entry()?.version).toBe('1.0.0');
    });

    /** The token the door computes for a finding set, restated from its documented shape (package id + sorted identities). */
    const tokenFor = (identities: unknown[][]): string => 'schema-upgrade:' + createHash('sha256')
        .update(JSON.stringify([VENDOR, identities.map((i) => JSON.stringify(i)).sort()]))
        .digest('hex').slice(0, 32);

    it('the token restated from the documented shape is the one the door answers (the helper below is sound)', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.payload.error.details.findingSet).toBe(tokenFor([['suspected_rename', 'acme_lead', 'company', 'text', [['account_name', 'text']]]]));
    });

    it('`true` confirms nothing', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: V2, confirmSchemaUpgrade: true }));
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toMatch(/`true` confirms nothing/);
        expect(door.register).not.toHaveBeenCalled();
    });

    it('a destructive type change (a stored field turned formula) is refused 409', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', { company: { type: 'formula' } }) }));
        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({
            kind: 'type_change', field: 'company', from: 'text', to: 'formula', category: 'destructive',
        })]);
        expect(door.register).not.toHaveBeenCalled();
    });

    it('an orphaned install (served by the registry, no ledger record) is compared against the body the registry serves', async () => {
        const registryPackages: Row[] = [];
        const door = await mount({ registryPackages });
        registryPackages.push({ manifest: V1 }); // registered after boot: an orphan, not user code

        // A retype against the registry's body is refused like any other.
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', { company: { type: 'number' } }) }));
        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({
            kind: 'type_change', field: 'company', from: 'text', to: 'number', category: 'needs_confirm',
        })]);
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});

        // CONTROL: the same orphan upgraded with no field change installs, unasked.
        const clean = await door.install(makeC({ manifest: vendorBody('2.0.0', { company: { type: 'text' }, region: { type: 'text' } }) }));
        expect(clean.status).toBe(200);
        expect(entry()?.schemaUpgradeConfirmation).toBeUndefined();
    });

    it('an orphan whose registry row carries no body is refused 409 installed_record_missing; its token installs', async () => {
        const registryPackages: Row[] = [];
        const door = await mount({ registryPackages });
        registryPackages.push({ id: VENDOR }); // served, but no body to compare against

        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('SCHEMA_UPGRADE_CONFIRMATION_REQUIRED');
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({ kind: 'installed_record_missing' })]);
        expect(res.payload.error.details.findingSet).toBe(tokenFor([['installed_record_missing']]));
        expect(door.register).not.toHaveBeenCalled();
        expect(door.planUpgrade).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual({});

        const confirmed = await door.install(makeC({ manifest: V2, confirmSchemaUpgrade: res.payload.error.details.findingSet }));
        expect(confirmed.status).toBe(200);
        expect(entry()?.schemaUpgradeConfirmation).toMatchObject({ findingSet: res.payload.error.details.findingSet, confirmedBy: INSTALLER });
    });

    it('a needs_confirm type change is refused 409, judged on its category', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', { company: { type: 'number' } }) }));
        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({
            kind: 'type_change', object: 'acme_lead', field: 'company', from: 'text', to: 'number', category: 'needs_confirm',
        })]);
        expect(door.register).not.toHaveBeenCalled();
    });

    it('a declared rename is refused 501 by name, token or not, and writes nothing', async () => {
        const door = await mount({ installed: V1 });
        const before = ledgerFiles();
        const renamed = vendorBody('2.0.0', { account_name: { type: 'text', renamedFrom: ['company'] } });

        // The real token of this verdict's finding set — the empty set — which a caller can compute.
        for (const extra of [{}, { confirmSchemaUpgrade: tokenFor([]) }]) {
            const res = await door.install(makeC({ manifest: renamed, ...extra }));
            expect(res.status).toBe(501);
            expect(res.payload.error.code).toBe('NOT_IMPLEMENTED');
            expect(res.payload.error.details.declaredRenames).toEqual([
                { object: 'acme_lead', from: 'company', to: 'account_name', fromType: 'text', toType: 'text' },
            ]);
            expect(res.payload.error.details.findings).toEqual([]);
            expect(res.payload.error.message).toContain('acme_lead.company → acme_lead.account_name');
        }
        expect(door.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });

    it('a declared rename that also retypes needs_confirm still owes the type change its confirmation', async () => {
        const door = await mount({ installed: V1 });
        const token = tokenFor([['type_change', 'acme_lead', 'account_name', 'text', 'number', 'needs_confirm', 'company']]);
        const res = await door.install(makeC({ manifest: vendorBody('2.0.0', { account_name: { type: 'number', renamedFrom: ['company'] } }), confirmSchemaUpgrade: token }));
        expect(res.status).toBe(501);
        expect(res.payload.error.details.findings).toEqual([expect.objectContaining({
            kind: 'type_change', field: 'account_name', renamedFrom: 'company', from: 'text', to: 'number', category: 'needs_confirm',
        })]);
    });

    it('a safe type change, a removed field and a seed change install unrefused', async () => {
        const installed = vendorBody('1.0.0', { company: { type: 'text' }, score: { type: 'formula' }, note: { type: 'text' } },
            [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', company: 'Acme' }] }]);
        const incoming = vendorBody('2.0.0', { company: { type: 'text' }, score: { type: 'number' } },
            [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', company: 'Acme Corp' }] }]);
        // The plan lists all three, and none is a finding the gate confirms.
        const plan = comparePackageVersions(fold(installed), fold(incoming));
        expect(plan.typeChanges).toEqual([expect.objectContaining({ field: 'score', category: 'safe' })]);
        expect(plan.fields.removed).toEqual([expect.objectContaining({ field: 'note' })]);
        expect(plan.seeds.changed).toHaveLength(1);

        const door = await mount({ installed });
        const res = await door.install(makeC({ manifest: incoming }));
        expect(res.status).toBe(200);
        expect(entry()?.version).toBe('2.0.0');
        expect(entry()?.schemaUpgradeConfirmation).toBeUndefined();
    });

    it('a re-install with no findings installs unchanged and records no confirmation', async () => {
        const door = await mount({ installed: V1 });
        const res = await door.install(makeC({ manifest: vendorBody('1.0.1', { company: { type: 'text' } }, [{ object: 'acme_lead', mode: 'upsert', records: [{ name: 'a', company: 'Acme' }] }]) }));
        expect(res.status).toBe(200);
        expect(door.planUpgrade).not.toHaveBeenCalled();
        expect(entry()?.version).toBe('1.0.1');
        expect(entry()?.schemaUpgradeConfirmation).toBeUndefined();
    });

    it('without planUpgrade the refusal is the same, its findings carrying no row counts', async () => {
        const door = await mount({ installed: V1, planUpgrade: false });
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings[0]).not.toHaveProperty('rows');
    });

    it('a first install is never compared', async () => {
        const door = await mount();
        const res = await door.install(makeC({ manifest: V2 }));
        expect(res.status).toBe(200);
        expect(entry()?.schemaUpgradeConfirmation).toBeUndefined();
    });
});
