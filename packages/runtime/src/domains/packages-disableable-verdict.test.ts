// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` read doors carry the disable door's OWN verdict, `disableable`
 * (#28318), beside `writable`.
 *
 * ## The defect this pins against
 *
 * The disable door (`PATCH /packages/:id/disable`) accepts a module of an
 * installed app (#28117): a `type: 'module'` package that directly depends on
 * an installed `type: 'app'` package, outside a `system` / `cloud` scope. Such
 * a module is read-only for authoring, so its row says `writable: false`, and
 * the Console offered Disable only from `writable`. The server accepted a
 * disable no client could offer, and the answer was nowhere on the wire.
 *
 * ## What is asserted
 *
 * - The verdict per shape, on the list door and the detail door: the suite
 *   module is `disableable: true` while `writable: false`; the controls
 *   (`system` / `cloud` scope, no installed app, a non-module package) answer
 *   what the door answers.
 * - AGREEMENT: on the whole fixture set, row by row, the served `disableable`
 *   equals the door's accept (200, package disabled) or refusal (422
 *   `WRITABLE_PACKAGE_REQUIRED`, package still enabled). This is the pin that
 *   holds the two readers to one predicate: a served constant reds it.
 * - The served body parses through its declared contract with both verdicts
 *   kept, and the registry's own records never gain the key.
 *
 * A REAL {@link SchemaRegistry} (the records are what `installPackage`
 * produces) through the real dispatcher, with `manifests` standing in for the
 * engine's boot map exactly as `packages-writable-verdict.test.ts` does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { GetInstalledPackageResponseSchema, ListInstalledPackagesResponseSchema } from '@objectstack/spec/api-assembled';

// ── the fixture set ──────────────────────────────────────────────────────────
const APP = 'com.acme.suite';
/** The subject: a module of the installed app, booted with it. */
const SUITE_MODULE = 'com.acme.suite.orders';
/** The same tie, installed from the marketplace with no scope key on the row. */
const SUITE_MODULE_SCOPELESS = 'com.acme.suite.billing';
const SYSTEM_MODULE = 'com.acme.suite.platform_bits';
const CLOUD_MODULE = 'com.acme.suite.cloud_bits';
/** A module that declares no dependency at all. */
const ORPHAN_MODULE = 'com.acme.orphan';
/** A module whose declared app is not installed here. */
const MODULE_OF_ABSENT_APP = 'com.acme.ghost.reports';
const ABSENT_APP = 'com.acme.ghost';
/** A module whose installed dependency is a plugin, not an app. */
const PLUGIN = 'com.acme.connector';
const MODULE_OF_PLUGIN = 'com.acme.connector.extras';
/** Non-module packages: the door answers them by `writable` alone. */
const DB_BASE = 'com.acme.mybase';
const SYSTEM_BASE = 'com.objectstack.platform';

function manifest(id: string, extra: Record<string, unknown> = {}) {
    return { id, name: id, version: '1.0.0', ...extra } as any;
}

const onApp = { dependencies: { [APP]: '^1.0.0' } };

/** id → [manifest, install source, booted into `engine.manifests`]. */
const FIXTURES: Record<string, [any, 'code' | 'marketplace' | 'authored', boolean]> = {
    [APP]: [manifest(APP, { type: 'app', scope: 'project' }), 'code', true],
    [SUITE_MODULE]: [manifest(SUITE_MODULE, { type: 'module', scope: 'project', ...onApp }), 'code', true],
    [SUITE_MODULE_SCOPELESS]: [manifest(SUITE_MODULE_SCOPELESS, { type: 'module', ...onApp }), 'marketplace', true],
    [SYSTEM_MODULE]: [manifest(SYSTEM_MODULE, { type: 'module', scope: 'system', ...onApp }), 'code', true],
    [CLOUD_MODULE]: [manifest(CLOUD_MODULE, { type: 'module', scope: 'cloud', ...onApp }), 'code', true],
    [ORPHAN_MODULE]: [manifest(ORPHAN_MODULE, { type: 'module', scope: 'project' }), 'code', true],
    [MODULE_OF_ABSENT_APP]: [
        manifest(MODULE_OF_ABSENT_APP, { type: 'module', scope: 'project', dependencies: { [ABSENT_APP]: '^1.0.0' } }),
        'code',
        true,
    ],
    [PLUGIN]: [manifest(PLUGIN, { type: 'plugin', scope: 'project' }), 'code', true],
    [MODULE_OF_PLUGIN]: [
        manifest(MODULE_OF_PLUGIN, { type: 'module', scope: 'project', dependencies: { [PLUGIN]: '^1.0.0' } }),
        'code',
        true,
    ],
    [DB_BASE]: [manifest(DB_BASE, { type: 'app' }), 'authored', false],
    [SYSTEM_BASE]: [manifest(SYSTEM_BASE, { type: 'app', scope: 'system' }), 'code', false],
};

/** What the door is expected to answer for each row — the verdict the row must serve. */
const EXPECTED: Record<string, { writable: boolean; disableable: boolean }> = {
    [APP]: { writable: false, disableable: false },
    [SUITE_MODULE]: { writable: false, disableable: true },
    [SUITE_MODULE_SCOPELESS]: { writable: false, disableable: true },
    [SYSTEM_MODULE]: { writable: false, disableable: false },
    [CLOUD_MODULE]: { writable: false, disableable: false },
    [ORPHAN_MODULE]: { writable: false, disableable: false },
    [MODULE_OF_ABSENT_APP]: { writable: false, disableable: false },
    [PLUGIN]: { writable: false, disableable: false },
    [MODULE_OF_PLUGIN]: { writable: false, disableable: false },
    [DB_BASE]: { writable: true, disableable: true },
    [SYSTEM_BASE]: { writable: false, disableable: false },
};

function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    const manifests = new Map<string, any>();
    for (const [id, [m, source, booted]] of Object.entries(FIXTURES)) {
        registry.installPackage(m, source);
        if (booted) manifests.set(id, m);
    }
    const objectql = { registry, manifests };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? objectql : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry };
}

/** Holds `manage_metadata` and the ADR-0106 D4 read set; the caller gate is not this file's subject. */
const admin = (): any => ({
    request: {},
    environmentId: 'pkg-disableable-verdict-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'], tenantId: 'org_acme' },
});

type Row = { manifest: { id: string }; writable?: boolean; disableable?: boolean } & Record<string, unknown>;

async function list(dispatcher: HttpDispatcher, query: Record<string, unknown> = {}): Promise<Row[]> {
    const r = await dispatcher.handlePackages('/', 'GET', undefined, query, admin());
    expect(r.response?.status ?? 200).toBe(200);
    return r.response?.body?.data?.packages as Row[];
}

const byId = (rows: Row[], id: string): Row => {
    const row = rows.find((p) => p.manifest?.id === id);
    if (!row) throw new Error(`row ${id} missing from listing`);
    return row;
};

// `setPackageDisabled` writes a real JSON file under OS_HOME on the accept path.
let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-pkg-disableable-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. The verdict, per shape — both read doors
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /packages — every row carries the disable door\'s verdict (#28318)', () => {
    it('a module of an installed app is disableable: true while writable: false', async () => {
        const rows = await list(make().dispatcher);
        for (const id of [SUITE_MODULE, SUITE_MODULE_SCOPELESS]) {
            expect(byId(rows, id)).toMatchObject({ writable: false, disableable: true });
        }
    });

    it('CONTROL: a module of the installed app in a system or cloud scope is disableable: false', async () => {
        const rows = await list(make().dispatcher);
        expect(byId(rows, SYSTEM_MODULE).disableable).toBe(false);
        expect(byId(rows, CLOUD_MODULE).disableable).toBe(false);
    });

    it('CONTROL: a module with no installed app is disableable: false', async () => {
        const rows = await list(make().dispatcher);
        expect(byId(rows, ORPHAN_MODULE).disableable).toBe(false);
        expect(byId(rows, MODULE_OF_ABSENT_APP).disableable).toBe(false);
        // An installed dependency that is a plugin, not an app, is no tie either.
        expect(byId(rows, MODULE_OF_PLUGIN).disableable).toBe(false);
    });

    it('CONTROL: a non-module package is disableable exactly when it is writable (the door\'s answer)', async () => {
        const rows = await list(make().dispatcher);
        for (const id of [APP, PLUGIN, DB_BASE, SYSTEM_BASE]) {
            const row = byId(rows, id);
            expect(row.disableable).toBe(row.writable);
        }
        expect(byId(rows, DB_BASE).disableable).toBe(true);
        expect(byId(rows, APP).disableable).toBe(false);
    });

    it('serves the expected pair on every row of the fixture set', async () => {
        const rows = await list(make().dispatcher);
        expect(Object.fromEntries(rows.map((r) => [r.manifest.id, { writable: r.writable, disableable: r.disableable }])))
            .toEqual(EXPECTED);
    });

    it('carries the verdict through the ?type= filter too', async () => {
        const rows = await list(make().dispatcher, { type: 'module' });
        expect(byId(rows, SUITE_MODULE).disableable).toBe(true);
        expect(byId(rows, SYSTEM_MODULE).disableable).toBe(false);
    });

    it('the detail door serves the same verdict as the list door, row by row', async () => {
        const { dispatcher } = make();
        const rows = await list(dispatcher);
        for (const id of Object.keys(FIXTURES)) {
            const r = await dispatcher.handlePackages(`/${encodeURIComponent(id)}`, 'GET', undefined, {}, admin());
            expect(r.response?.status ?? 200).toBe(200);
            expect(r.response?.body?.data?.disableable).toBe(byId(rows, id).disableable);
            expect(r.response?.body?.data?.writable).toBe(byId(rows, id).writable);
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. AGREEMENT — the served verdict IS the door's answer
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /packages/:id/disable answers exactly what the row served (#28318)', () => {
    for (const id of Object.keys(FIXTURES)) {
        it(`${id}: served disableable equals the door's accept / refuse`, async () => {
            // A fresh registry per row: an accepted disable changes the state the
            // next row would be read against.
            const { dispatcher, registry } = make();
            const served = byId(await list(dispatcher), id).disableable;
            expect(typeof served).toBe('boolean');

            const r = await dispatcher.handlePackages(`/${encodeURIComponent(id)}/disable`, 'PATCH', {}, {}, admin());
            const accepted = (r.response?.status ?? 200) === 200;
            expect(accepted).toBe(served);
            if (accepted) {
                expect(registry.getPackage(id)?.enabled).toBe(false);
            } else {
                expect(r.response?.status).toBe(422);
                expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
                expect(registry.getPackage(id)?.enabled).toBe(true);
            }
        });
    }

    it('non-vacuity: the fixture set holds both answers, and a disableable row that is not writable', () => {
        const verdicts = Object.values(EXPECTED);
        expect(verdicts.some((v) => v.disableable)).toBe(true);
        expect(verdicts.some((v) => !v.disableable)).toBe(true);
        expect(verdicts.some((v) => v.disableable && !v.writable)).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. The contract, and nothing stored
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /packages — the verdict is declared, computed and never stored (#28318)', () => {
    it('the served bodies parse through their declared contracts with both verdicts kept', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages('/', 'GET', undefined, {}, admin());
        const parsed = ListInstalledPackagesResponseSchema.parse(r.response?.body);
        expect(Object.fromEntries(parsed.data.packages.map((row) => [row.manifest.id, { writable: row.writable, disableable: row.disableable }])))
            .toEqual(EXPECTED);
        const detail = await dispatcher.handlePackages(`/${SUITE_MODULE}`, 'GET', undefined, {}, admin());
        expect(GetInstalledPackageResponseSchema.parse(detail.response?.body).data)
            .toMatchObject({ writable: false, disableable: true });
    });

    it('the registry\'s own records never gain a `disableable` key (spread copy, no mutation)', async () => {
        const { dispatcher, registry } = make();
        await list(dispatcher);
        await dispatcher.handlePackages(`/${SUITE_MODULE}`, 'GET', undefined, {}, admin());
        for (const record of registry.getAllPackages() as unknown as Row[]) {
            expect('disableable' in record).toBe(false);
        }
    });

    it('the verdict follows the running engine: uninstall the app and its module stops being disableable', async () => {
        const { dispatcher, registry } = make();
        expect(byId(await list(dispatcher), SUITE_MODULE).disableable).toBe(true);
        expect(registry.uninstallPackage(APP)).toBe(true);
        expect(registry.getPackage(APP)).toBeUndefined();
        expect(byId(await list(dispatcher), SUITE_MODULE).disableable).toBe(false);
    });
});
