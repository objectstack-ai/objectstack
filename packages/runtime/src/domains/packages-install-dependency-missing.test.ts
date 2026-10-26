// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D2 at `POST /api/v1/packages`: a package whose declared
 * `dependencies` the environment does not satisfy is refused `422
 * DEPENDENCY_MISSING` with its facts, on both arms of the door, and nothing is
 * installed.
 *
 * ## The harness
 *
 * The protocol primitive and the registry are REAL
 * (`ObjectStackProtocolImplementation` over a `SchemaRegistry`), so the
 * refusal under test is the one production throws, the dependency is
 * installed through the same door the dependent is, and "not installed" is
 * read back through the door's `GET`. Each refusal asserts the ADR-0112
 * envelope (`code` and `status`), never a bare throw. `OS_HOME` is redirected
 * because the lit controls really install.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-install-dependency-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const ADMIN = () => ({
    request: {},
    environmentId: 'pkg-install-dependency-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** The depended-on app, at a version the dependent's range refuses and one it admits. */
const SALES_5 = { id: 'com.example.sales', name: 'Sales', version: '5.4.0', scope: 'project', type: 'app' };
const SALES_6 = { ...SALES_5, version: '6.2.0' };
/** The dependent: 「请先安装 Sales 6.x」. */
const PSA = {
    id: 'com.example.psa', name: 'PSA', version: '1.0.0', scope: 'project', type: 'app',
    dependencies: { 'com.example.sales': '6.x' },
};

function silentRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as unknown as { logLevel: string }).logLevel = 'silent';
    return registry;
}

/** The composed door; `protocol: null` takes the door's no-protocol fallback arm. */
function door(options: { protocol?: null } = {}) {
    const registry = silentRegistry();
    const engine: any = { registry, find: async () => [], manifests: new Map() };
    const protocol = options.protocol === null ? null : new ObjectStackProtocolImplementation(engine, () => new Map());
    const ql: any = { registry, manifests: new Map() };
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return protocol ? Promise.resolve(protocol) : null;
            if (name === 'objectql') return Promise.resolve(ql);
            return null;
        },
        context: { getService: (name: string) => (name === 'objectql' ? ql : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry };
}

const install = (d: ReturnType<typeof door>, manifest: unknown) =>
    d.dispatcher.handlePackages('', 'POST', { manifest }, {}, ADMIN());
const read = (d: ReturnType<typeof door>, id: string) =>
    d.dispatcher.handlePackages(`/${id}`, 'GET', undefined, {}, ADMIN());

function expectDependencyRefusal(r: any, unmet: unknown[]) {
    expect(r.handled).toBe(true);
    expect(r.response.status, JSON.stringify(r.response.body)).toBe(422);
    const error = r.response.body.error;
    expect(r.response.body.success).toBe(false);
    expect(error.code).toBe('DEPENDENCY_MISSING');
    expect(error.httpStatus).toBe(422);
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);
    // The closed details shape: the compatibility verdict and the facts.
    expect(Object.keys(error.details).sort()).toEqual(['compatible', 'issues', 'unmet']);
    expect(error.details.compatible).toBe(false);
    expect(error.details.unmet).toEqual(unmet);
    expect(error.details.issues).toHaveLength(unmet.length);
    for (const issue of error.details.issues) {
        expect(issue).toEqual({ severity: 'error', category: 'dependency_missing', message: expect.any(String) });
        expect(error.message).toContain(issue.message);
    }
}

for (const arm of ['composed', 'fallback'] as const) {
    const make = () => (arm === 'composed' ? door() : door({ protocol: null }));

    describe(`POST /api/v1/packages (${arm} arm): ADR-0141 D2 refuses an unsatisfied dependency`, () => {
        it('refuses when the dependency is not installed: 422 with the facts, nothing installed', async () => {
            const d = make();
            expectDependencyRefusal(await install(d, PSA), [
                { packageId: 'com.example.psa', dependency: 'com.example.sales', range: '6.x', found: 'absent' },
            ]);
            expect(d.registry.getPackage(PSA.id)).toBeUndefined();
            expect((await read(d, PSA.id) as any).response.status).toBe(404);
        });

        it('refuses when the dependency is installed outside the range, naming the version found', async () => {
            const d = make();
            expect((await install(d, SALES_5) as any).response.status).toBe(201);
            expectDependencyRefusal(await install(d, PSA), [
                { packageId: 'com.example.psa', dependency: 'com.example.sales', range: '6.x', found: 'out-of-range', installedVersion: '5.4.0' },
            ]);
            expect(d.registry.getPackage(PSA.id)).toBeUndefined();
        });

        it('lit control: installs once the dependency is installed inside the range', async () => {
            const d = make();
            expect((await install(d, SALES_6) as any).response.status).toBe(201);
            const r: any = await install(d, PSA);
            expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
            expect((await read(d, PSA.id) as any).response.status).toBe(200);
        });
    });
}
