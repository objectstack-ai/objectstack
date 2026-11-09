// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D7 at `POST /api/v1/packages`: a package created at runtime cannot
 * contribute navigation, so its `navigationContributions` are refused `400
 * VALIDATION_ERROR` on both arms of the door, and nothing is stored.
 *
 * Neither install limb registers a contribution (only a code package's
 * `ObjectQL.registerApp` does), so the key used to be stored, answered `201`
 * and never shown — not after a restart either. Ruling A on the card: refuse
 * it loudly, naming the routes that work.
 *
 * ## The harness
 *
 * The protocol primitive and the registry are REAL
 * (`ObjectStackProtocolImplementation` over an `ObjectQL` engine's
 * `SchemaRegistry`), so the refusal is the one production answers, and the
 * code-package half is registered through the engine's real `registerApp`.
 * Each refusal asserts the ADR-0112 envelope (`code` and `status`), never a
 * bare throw. `OS_HOME` is redirected because the lit controls really install.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation, runtimeNavigationContributionsRefusal } from '@objectstack/metadata-protocol';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-install-nav-contributions-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const ADMIN = () => ({
    request: {},
    environmentId: 'pkg-install-nav-contributions-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** The app a code package ships, with one group a contribution can target. */
const SUITE = {
    id: 'com.qa.navsuite', name: 'Suite', version: '1.0.0', type: 'app', namespace: 'qs',
    apps: [{
        name: 'qs_app', label: 'Suite',
        navigation: [{ id: 'g_sales', type: 'group', label: 'Sales', children: [{ id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'qs_account' }] }],
    }],
};
/** A CODE package contributing into the suite's app, registered at load. */
const ORDERS_CODE = {
    id: 'com.qa.navorders', name: 'Orders', version: '1.0.0', type: 'module', namespace: 'qs',
    dependencies: { [SUITE.id]: '^1.0.0' },
    navigationContributions: [{ app: 'qs_app', group: 'g_sales', items: [{ id: 'nav_orders', type: 'object', label: 'Orders', objectName: 'qs_order' }] }],
};
/** The runtime-created package the card measured: a menu entry for another package's app. */
const RUNTIME_PKG = {
    id: 'com.qa.navruntime', name: 'Runtime', version: '1.0.0', type: 'module',
    navigationContributions: [{ app: 'qs_app', group: 'g_sales', items: [{ id: 'nav_contracts', type: 'object', label: 'Contracts', objectName: 'qs_contract' }] }],
};

/** The composed door; `protocol: null` takes the door's no-protocol fallback arm. */
function door(options: { protocol?: null } = {}) {
    const engine = new ObjectQL();
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    const registry = engine.registry;
    const protocolEngine: any = { registry, find: async () => [], manifests: new Map() };
    const protocol = options.protocol === null ? null : new ObjectStackProtocolImplementation(protocolEngine, () => new Map());
    const ql: any = { registry, manifests: new Map() };
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return protocol ? Promise.resolve(protocol) : null;
            if (name === 'objectql') return Promise.resolve(ql);
            return null;
        },
        context: { getService: (name: string) => (name === 'objectql' ? ql : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry, engine };
}

const install = (d: ReturnType<typeof door>, body: unknown) =>
    d.dispatcher.handlePackages('', 'POST', body, {}, ADMIN());
const read = (d: ReturnType<typeof door>, id: string) =>
    d.dispatcher.handlePackages(`/${id}`, 'GET', undefined, {}, ADMIN());

/** Every entry of the served app, `group/id`, in served order. */
const served = (d: ReturnType<typeof door>): string[] =>
    ((d.registry.getApp('qs_app') as any)?.navigation ?? []).flatMap((n: any) =>
        n.type === 'group' ? (n.children ?? []).map((c: any) => `${n.id}/${c.id}`) : [n.id]);

function expectNavRefusal(r: any) {
    expect(r.handled).toBe(true);
    expect(r.response.status, JSON.stringify(r.response.body)).toBe(400);
    const error = r.response.body.error;
    expect(r.response.body.success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);
    // The door answers the primitive's own sentence, on both arms.
    expect(error.message).toBe(runtimeNavigationContributionsRefusal(RUNTIME_PKG));
}

for (const arm of ['composed', 'fallback'] as const) {
    const make = () => (arm === 'composed' ? door() : door({ protocol: null }));

    describe(`POST /api/v1/packages (${arm} arm): navigationContributions on a runtime-created package`, () => {
        it('refuses the key: 400 VALIDATION_ERROR naming both working routes, nothing stored', async () => {
            const d = make();
            expectNavRefusal(await install(d, { manifest: RUNTIME_PKG }));
            expect(d.registry.getPackage(RUNTIME_PKG.id)).toBeUndefined();
            expect((await read(d, RUNTIME_PKG.id) as any).response.status).toBe(404);
        });

        it('refuses the bare-manifest body form the same way', async () => {
            const d = make();
            expectNavRefusal(await install(d, RUNTIME_PKG));
            expect(d.registry.getPackage(RUNTIME_PKG.id)).toBeUndefined();
        });

        it('refuses ahead of the 409: an installed id with the key answers the same 400', async () => {
            const d = make();
            const { navigationContributions: _dropped, ...withNone } = RUNTIME_PKG;
            expect((await install(d, { manifest: withNone }) as any).response.status).toBe(201);
            expectNavRefusal(await install(d, { manifest: RUNTIME_PKG }));
            expect((d.registry.getPackage(RUNTIME_PKG.id) as any)?.manifest).not.toHaveProperty('navigationContributions');
        });

        it('lit control: the same package without the key, or with an empty list, installs', async () => {
            const d = make();
            const { navigationContributions: _dropped, ...withNone } = RUNTIME_PKG;
            expect((await install(d, { manifest: withNone }) as any).response.status).toBe(201);
            const empty: any = await install(d, { manifest: { ...RUNTIME_PKG, id: 'com.qa.navempty', navigationContributions: [] } });
            expect(empty.response.status, JSON.stringify(empty.response.body)).toBe(201);
        });

        it("a code package's contribution, registered at load, is still applied and untouched by the refusal", async () => {
            const d = make();
            d.engine.registerApp(SUITE as any);
            d.engine.registerApp(ORDERS_CODE as any);
            expect(served(d), 'precondition: the code contribution is served').toEqual(['g_sales/nav_accounts', 'g_sales/nav_orders']);
            expectNavRefusal(await install(d, { manifest: RUNTIME_PKG }));
            expect(served(d)).toEqual(['g_sales/nav_accounts', 'g_sales/nav_orders']);
            expect(d.registry.getAppNavContributions('qs_app').map((c) => c.packageId)).toEqual([ORDERS_CODE.id]);
        });
    });
}
