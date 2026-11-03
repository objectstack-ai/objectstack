// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D3's paired customization package, at its ensure door:
 * `POST /api/v1/packages/:id/ensure-customization` answers the pair of an
 * installed read-only base — `<base>.custom`, explicit namespace
 * `<base namespace>_custom`, a dependency on the base at `^<major>` — and
 * whether this call created it. And the two install doors that could mint a
 * pair-shaped id without what the ensure door writes: `POST /api/v1/packages`
 * and `POST /api/v1/packages/:id/duplicate` refuse it, naming the door.
 *
 * ## The harness
 *
 * The protocol primitive and the registry are REAL
 * (`ObjectStackProtocolImplementation` over a `SchemaRegistry`), so every
 * refusal under test is the one production throws and every create goes
 * through `installPackage`, the install door's own primitive. The `package`
 * service is a recording double of `sys_packages`' `publish`, so "written" and
 * "not written" are counted, and a failing persist can be staged. Each refusal
 * asserts the ADR-0112 envelope (`code` and `status`) and that nothing was
 * installed or persisted. `OS_HOME` is redirected because the lit controls
 * really install.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ApiErrorSchema, EnsureCustomizationPackageResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-ensure-customization-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const ctx = (executionContext: Record<string, unknown>): any => ({
    request: {},
    environmentId: 'pkg-ensure-customization-test',
    executionContext,
});
/** A `manage_metadata` holder under `single`: the install door's caller. */
const ADMIN = { userId: 'u_pkg_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] };
/** An organization's administrator: holds `manage_metadata`, is not the platform operator. */
const TENANT_ADMIN = { userId: 'u_tenant', tenantId: 'org_a', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' };
/** The platform operator rung. */
const OPERATOR = { userId: 'u_operator', systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' };

/** The base: an installed app the customer cannot author into (a platform scope). */
const CRM = { id: 'com.acme.crm', name: 'CRM', version: '3.4.1', type: 'app', namespace: 'crm', scope: 'system' };
const PAIR_ID = 'com.acme.crm.custom';
const ENSURE_PATH = `POST /api/v1/packages/${CRM.id}/ensure-customization`;

interface Options {
    /** `null` takes the door's no-protocol fallback arm (install door only). */
    protocol?: null;
    /** The `tenancy` service's posture; `null` registers no service. */
    posture?: 'single' | 'isolated' | 'group' | null;
    /** Stage `sys_packages`' `publish`: the call index (0-based) → its outcome. */
    publish?: (call: number, manifest: any) => Promise<unknown>;
}

function silentRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as unknown as { logLevel: string }).logLevel = 'silent';
    return registry;
}

/** The composed door over a real protocol and registry. */
function door(options: Options = {}) {
    const registry = silentRegistry();
    const manifests = new Map<string, unknown>();
    const engine: any = { registry, find: async () => [], manifests };
    const published: any[] = [];
    const packageService = {
        publish: async ({ manifest }: { manifest: any }) => {
            const call = published.length;
            published.push(structuredClone(manifest));
            return options.publish ? options.publish(call, manifest) : { success: true };
        },
    };
    const services = new Map<string, unknown>([['package', packageService]]);
    const protocol = options.protocol === null
        ? null
        : new ObjectStackProtocolImplementation(engine, () => services);
    const ql: any = { registry, manifests };
    const named: Record<string, unknown> = { objectql: ql };
    if (protocol) named.protocol = protocol;
    if (options.posture) named.tenancy = { posture: options.posture };
    const resolve = (name: string): unknown => named[name] ?? null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry, engine, published, protocol };
}

type Door = ReturnType<typeof door>;

const ensure = (d: Door, baseId: string, caller: Record<string, unknown> = ADMIN, body?: unknown, query: Record<string, unknown> = {}) =>
    d.dispatcher.handlePackages(`/${encodeURIComponent(baseId)}/ensure-customization`, 'POST', body, query, ctx(caller)) as Promise<any>;
const install = (d: Door, manifest: unknown) =>
    d.dispatcher.handlePackages('', 'POST', { manifest }, {}, ctx(ADMIN)) as Promise<any>;
const read = (d: Door, id: string) =>
    d.dispatcher.handlePackages(`/${id}`, 'GET', undefined, {}, ctx(ADMIN)) as Promise<any>;
const ids = (d: Door) => d.registry.getAllPackages().map((p: any) => p.manifest?.id ?? p.id).sort();

/**
 * A package registered as a boot or an app install registers it — with no
 * door's judgement. `marketplace` for an installed app, `code` for a booted one.
 */
function register(d: Door, manifest: Record<string, unknown>, source: 'marketplace' | 'code' = 'marketplace'): void {
    d.registry.installPackage(manifest as any, source);
}

/** The base installed as production holds it: an installed app of a platform scope. */
function withBase(d: Door, base: Record<string, unknown> = CRM): Door {
    register(d, base);
    return d;
}

function expectRefusal(r: any, status: number, code: string, ...phrases: string[]) {
    expect(r.handled).toBe(true);
    expect(r.response.status, JSON.stringify(r.response.body)).toBe(status);
    expect(r.response.body.success).toBe(false);
    const error = r.response.body.error;
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);
    for (const phrase of phrases) expect(String(error.message)).toContain(phrase);
}

describe(`${ENSURE_PATH}: creates the pair through installPackage`, () => {
    it('creates com.acme.crm.custom with namespace crm_custom (never `custom`) and ^3: 201, created true', async () => {
        const d = withBase(door());
        const r = await ensure(d, CRM.id);
        expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
        expect(r.response.body.success).toBe(true);
        // The answer is the declaration's, parsed whole.
        const answer = EnsureCustomizationPackageResponseSchema.parse(r.response.body.data);
        expect(answer).toEqual({
            basePackageId: CRM.id,
            packageId: PAIR_ID,
            namespace: 'crm_custom',
            dependencyRange: '^3',
            created: true,
            writable: true,
        });
        // The installed record carries what the answer says — the namespace is
        // explicit, not the `custom` an id-derived default would give.
        const manifest: any = d.registry.getPackage(PAIR_ID)?.manifest;
        expect(manifest).toMatchObject({
            id: PAIR_ID,
            name: 'CRM (custom)',
            version: '0.1.0',
            type: 'module',
            namespace: 'crm_custom',
            dependencies: { [CRM.id]: '^3' },
        });
        // Persisted once, as installed — the install primitive's own write.
        expect(d.published).toHaveLength(1);
        expect(d.published[0]).toMatchObject({ id: PAIR_ID, namespace: 'crm_custom', dependencies: { [CRM.id]: '^3' } });
        // Read back through the door's own GET.
        expect((await read(d, PAIR_ID)).response.status).toBe(200);
    });

    it('a base provided by code (a booted package, scope project) has a pair too', async () => {
        const d = door();
        const code = { id: 'com.acme.helpdesk', name: 'Helpdesk', version: '12.0.0', type: 'app', namespace: 'helpdesk' };
        register(d, code, 'code');
        d.engine.manifests.set(code.id, code);
        const r = await ensure(d, code.id);
        expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
        expect(r.response.body.data).toMatchObject({ packageId: 'com.acme.helpdesk.custom', namespace: 'helpdesk_custom', dependencyRange: '^12' });
    });

    it('a re-ensure is a no-op: 200, created false, the same answer, nothing written', async () => {
        const d = withBase(door());
        const first = await ensure(d, CRM.id);
        expect(first.response.status).toBe(201);
        const before = structuredClone(d.registry.getPackage(PAIR_ID));
        const again = await ensure(d, CRM.id);
        expect(again.response.status, JSON.stringify(again.response.body)).toBe(200);
        expect(EnsureCustomizationPackageResponseSchema.parse(again.response.body.data))
            .toEqual({ ...first.response.body.data, created: false });
        expect(d.published).toHaveLength(1);
        expect(d.registry.getPackage(PAIR_ID)).toEqual(before);
    });

    it('an existing valid pair is answered unchanged, with the range it declares', async () => {
        const d = withBase(door());
        const exported = { id: PAIR_ID, name: 'Exported pair', version: '2.0.0', type: 'module', namespace: 'crm_custom', dependencies: { [CRM.id]: '>=3.0.0' } };
        expect((await install(d, exported)).response.status).toBe(201);
        const writes = d.published.length;
        const r = await ensure(d, CRM.id);
        expect(r.response.status, JSON.stringify(r.response.body)).toBe(200);
        expect(r.response.body.data).toMatchObject({ created: false, dependencyRange: '>=3.0.0', namespace: 'crm_custom' });
        expect(d.registry.getPackage(PAIR_ID)?.manifest).toMatchObject({ name: 'Exported pair', version: '2.0.0' });
        expect(d.published).toHaveLength(writes);
    });
});

describe(`${ENSURE_PATH}: each refusal is worded and leaves nothing`, () => {
    /** Run `act` and assert no package appeared and nothing was persisted. */
    async function leavesNothing(d: Door, act: () => Promise<any>): Promise<any> {
        const before = ids(d);
        const writes = d.published.length;
        const r = await act();
        expect(ids(d)).toEqual(before);
        expect(d.published).toHaveLength(writes);
        return r;
    }

    it('the base is not installed: 404', async () => {
        const d = door();
        const r = await leavesNothing(d, () => ensure(d, CRM.id));
        expectRefusal(r, 404, 'RESOURCE_NOT_FOUND', `Package '${CRM.id}' not found`, 'installed base');
        expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
    });

    it('the base is writable: 409, customize it directly', async () => {
        const d = door();
        const own = { id: 'com.acme.notes', name: 'Notes', version: '1.0.0', type: 'app', namespace: 'notes' };
        expect((await install(d, own)).response.status).toBe(201);
        const r = await leavesNothing(d, () => ensure(d, own.id));
        expectRefusal(r, 409, 'RESOURCE_CONFLICT', `Package '${own.id}' is writable: customize it directly`);
    });

    it('the base is itself a pair: 400, a pair is never paired again', async () => {
        const d = withBase(door());
        expect((await ensure(d, CRM.id)).response.status).toBe(201);
        const r = await leavesNothing(d, () => ensure(d, PAIR_ID));
        expectRefusal(r, 400, 'VALIDATION_ERROR', `Package '${PAIR_ID}' is itself a paired customization package`);
        expect(d.registry.getPackage(`${PAIR_ID}.custom`)).toBeUndefined();
    });

    it('the base declares no namespace: 409', async () => {
        const d = withBase(door(), { id: 'com.acme.bare', name: 'Bare', version: '1.0.0', type: 'app', scope: 'system' });
        const r = await leavesNothing(d, () => ensure(d, 'com.acme.bare'));
        expectRefusal(r, 409, 'RESOURCE_CONFLICT', "package 'com.acme.bare' declares no namespace");
    });

    it('the composed namespace fails the manifest grammar: 409, never truncated', async () => {
        const d = withBase(door(), { id: 'com.acme.long', name: 'Long', version: '1.0.0', type: 'app', namespace: 'abcdefghijklmn', scope: 'system' });
        const r = await leavesNothing(d, () => ensure(d, 'com.acme.long'));
        expectRefusal(r, 409, 'RESOURCE_CONFLICT', "'abcdefghijklmn_custom' exceeds the 20 characters", 'none is truncated or hashed');
    });

    it('the composed namespace is owned by another package: 422 NAMESPACE_CONFLICT naming the owner', async () => {
        const d = withBase(door());
        register(d, { id: 'com.other.squatter', name: 'Squatter', version: '1.0.0', type: 'app', namespace: 'crm_custom', scope: 'system' });
        const r = await leavesNothing(d, () => ensure(d, CRM.id));
        expectRefusal(r, 422, 'NAMESPACE_CONFLICT', "its namespace 'crm_custom' is already owned by package 'com.other.squatter'", 'has no alternative');
    });

    it('an owner the registry would read as a co-owner is refused all the same: the pair namespace is the pair\'s alone', async () => {
        const d = withBase(door());
        // A sitting owner of `crm_custom` that declares the pair: ADR-0141 D5's
        // `dependency` co-ownership, which the registry's gate would admit.
        register(d, {
            id: 'com.other.addon', name: 'Addon', version: '1.0.0', type: 'module', namespace: 'crm_custom', scope: 'system',
            dependencies: { [PAIR_ID]: '^0' },
        });
        const r = await leavesNothing(d, () => ensure(d, CRM.id));
        expectRefusal(r, 422, 'NAMESPACE_CONFLICT', "already owned by package 'com.other.addon'");
    });

    it('an installed pair that lacks the namespace or the dependency is refused, never adopted: 409', async () => {
        const cases = [
            { label: 'no dependency', manifest: { namespace: 'crm_custom' }, phrase: `a dependency on '${CRM.id}'` },
            { label: 'another namespace', manifest: { namespace: 'crmx_custom', dependencies: { [CRM.id]: '^3' } }, phrase: "namespace 'crm_custom' (it declares 'crmx_custom')" },
        ];
        for (const c of cases) {
            const d = withBase(door());
            // As a booted package would hold it: registered with no door's judgement.
            register(d, { id: PAIR_ID, name: 'Stray', version: '1.0.0', type: 'module', scope: 'system', ...c.manifest });
            const before = structuredClone(d.registry.getPackage(PAIR_ID));
            const r = await leavesNothing(d, () => ensure(d, CRM.id));
            expectRefusal(r, 409, 'RESOURCE_CONFLICT', `Package '${PAIR_ID}' is installed but is not the paired customization package`, c.phrase, 'not adopted or rewritten');
            expect(d.registry.getPackage(PAIR_ID), c.label).toEqual(before);
        }
    });

    it('the base version is not SemVer: 409, no range can be declared', async () => {
        const d = withBase(door(), { ...CRM, version: 'latest' });
        const r = await leavesNothing(d, () => ensure(d, CRM.id));
        expectRefusal(r, 409, 'RESOURCE_CONFLICT', "is at version 'latest', which is not a SemVer 2.0.0 version");
    });

    it('a body carrying keys is refused, not ignored: 400; an empty body is admitted', async () => {
        const d = withBase(door());
        const r = await leavesNothing(d, () => ensure(d, CRM.id, ADMIN, { namespace: 'mine' }));
        expectRefusal(r, 400, 'VALIDATION_ERROR', 'The ensure-customization door reads no body');
        expect((await ensure(d, CRM.id, ADMIN, {})).response.status).toBe(201);
    });

    it('a query parameter is refused (route rule 5, the closed set is empty): 400', async () => {
        const d = withBase(door());
        const r = await leavesNothing(d, () => ensure(d, CRM.id, ADMIN, undefined, { namespace: 'mine' }));
        expect(r.response.status, JSON.stringify(r.response.body)).toBe(400);
    });

    it('a protocol without the primitive: 501, nothing written', async () => {
        const d = withBase(door());
        (d.protocol as any).ensureCustomizationPackage = undefined;
        const r = await leavesNothing(d, () => ensure(d, CRM.id));
        expect(r.response.status).toBe(501);
    });
});

describe(`${ENSURE_PATH}: the caller's authority is the install door's`, () => {
    for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a tenant administrator is refused 403 PERMISSION_DENIED and nothing is written; the operator gets 201`, async () => {
            const d = withBase(door({ posture }));
            const refused = await ensure(d, CRM.id, TENANT_ADMIN);
            expectRefusal(refused, 403, 'PERMISSION_DENIED', `Ensuring the customization package of "${CRM.id}" is refused.`, `'${posture}' tenancy posture`);
            expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
            expect(d.published).toHaveLength(0);

            const admitted = await ensure(d, CRM.id, OPERATOR);
            expect(admitted.response.status, JSON.stringify(admitted.response.body)).toBe(201);
            expect(d.registry.getPackage(PAIR_ID)).toBeDefined();
        });
    }

    it('single: a manage_metadata holder gets 201', async () => {
        const d = withBase(door({ posture: 'single' }));
        const r = await ensure(d, CRM.id, TENANT_ADMIN);
        expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
    });

    it('a caller without manage_metadata is refused 403 by the capability gate, before the posture', async () => {
        const d = withBase(door({ posture: 'isolated' }));
        const r = await ensure(d, CRM.id, { userId: 'u_reader', systemPermissions: ['studio.access'] });
        expectRefusal(r, 403, 'PERMISSION_DENIED', 'requires the `manage_metadata` capability');
        expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
        expect(d.published).toHaveLength(0);
    });
});

describe(`${ENSURE_PATH}: one pair under concurrency`, () => {
    it('two concurrent calls leave one pair: one 201, one 200, one write', async () => {
        // Each persist settles a tick later, so both calls are in flight together.
        const d = withBase(door({ publish: () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 5)) }));
        const [a, b] = await Promise.all([ensure(d, CRM.id), ensure(d, CRM.id)]);
        expect([a.response.status, b.response.status].sort()).toEqual([200, 201]);
        expect([a.response.body.data.created, b.response.body.data.created].sort()).toEqual([false, true]);
        expect(ids(d).filter((id) => id === PAIR_ID)).toHaveLength(1);
        expect(d.published).toHaveLength(1);
    });

    it('a second call never answers for a pair whose create then fails: it waits, judges afresh, and creates', async () => {
        // The first persist fails after a tick (the install primitive undoes its
        // registry write); the second succeeds. A second call that read the
        // registry while the first was in flight would answer `200 created:
        // false` for a pair that is then removed.
        const d = withBase(door({
            publish: (call) => new Promise((resolve) => setTimeout(() => resolve(call === 0 ? { success: false, error: 'store down' } : { success: true }), 5)),
        }));
        const [a, b] = await Promise.all([ensure(d, CRM.id), ensure(d, CRM.id)]);
        expect(a.response.status, JSON.stringify(a.response.body)).toBeGreaterThanOrEqual(500);
        expect(b.response.status, JSON.stringify(b.response.body)).toBe(201);
        expect(b.response.body.data.created).toBe(true);
        expect(d.registry.getPackage(PAIR_ID)).toBeDefined();
        expect(d.published).toHaveLength(2);
    });
});

for (const arm of ['composed', 'fallback'] as const) {
    const make = () => withBase(arm === 'composed' ? door() : door({ protocol: null }));

    describe(`POST /api/v1/packages (${arm} arm): a pair-shaped id must carry what the ensure door writes`, () => {
        const pairManifest = (extra: Record<string, unknown>) => ({ id: PAIR_ID, name: 'Hand-made pair', version: '1.0.0', type: 'module', ...extra });

        const refusedCases: Array<{ label: string; manifest: Record<string, unknown>; phrase: string }> = [
            { label: 'neither', manifest: pairManifest({}), phrase: "lacks the explicit `namespace: 'crm_custom'`, and a dependency on 'com.acme.crm'" },
            { label: 'the id-derived namespace', manifest: pairManifest({ namespace: 'custom', dependencies: { [CRM.id]: '^3' } }), phrase: "`namespace: 'crm_custom'` (it declares 'custom')" },
            { label: 'no dependency', manifest: pairManifest({ namespace: 'crm_custom' }), phrase: "lacks a dependency on 'com.acme.crm'" },
        ];
        for (const c of refusedCases) {
            it(`refuses a pair manifest with ${c.label}: 400 naming the door, nothing installed`, async () => {
                const d = make();
                const r = await install(d, c.manifest);
                expectRefusal(r, 400, 'VALIDATION_ERROR', `Package '${PAIR_ID}' is the paired customization package of '${CRM.id}'`, c.phrase, ENSURE_PATH.replace('POST ', ''));
                expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
                expect(d.published).toHaveLength(0);
            });
        }

        it('lit control: an exported pair that declares both installs', async () => {
            const d = make();
            const r = await install(d, pairManifest({ namespace: 'crm_custom', dependencies: { [CRM.id]: '^3' } }));
            expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
            expect(d.registry.getPackage(PAIR_ID)?.manifest).toMatchObject({ namespace: 'crm_custom' });
        });

        it('a non-pair id is not judged by it', async () => {
            const d = make();
            const r = await install(d, { id: 'com.acme.customer', name: 'Customer', version: '1.0.0', type: 'app' });
            expect(r.response.status, JSON.stringify(r.response.body)).toBe(201);
        });
    });
}

describe('installPackage, the install primitive: an in-process caller is judged by the same predicate', () => {
    it('refuses a pair-shaped manifest without the namespace and the dependency: 400 naming the door, nothing installed', async () => {
        const d = withBase(door());
        await expect(d.protocol!.installPackage({ manifest: { id: PAIR_ID, name: 'In-process pair', version: '1.0.0', type: 'module' } } as any))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining(ENSURE_PATH.replace('POST ', '')) });
        expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
        expect(d.published).toHaveLength(0);
    });
});

describe('POST /api/v1/packages: an exported pair whose base is absent is the dependency check\'s refusal', () => {
    it('422 DEPENDENCY_MISSING, not the pair refusal', async () => {
        const d = door();
        const r = await install(d, { id: PAIR_ID, name: 'Exported pair', version: '1.0.0', type: 'module', namespace: 'crm_custom', dependencies: { [CRM.id]: '^3' } });
        expectRefusal(r, 422, 'DEPENDENCY_MISSING');
        expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
    });
});

describe('POST /api/v1/packages/:id/duplicate: a copy into a pair id is refused, naming the door', () => {
    it('400 before a row is read, nothing installed', async () => {
        const d = withBase(door());
        const source = { id: 'com.acme.notes', name: 'Notes', version: '1.0.0', type: 'app', namespace: 'notes' };
        expect((await install(d, source)).response.status).toBe(201);
        let rowsRead = 0;
        const find = d.engine.find;
        d.engine.find = async (...args: unknown[]) => { rowsRead++; return find(...args); };
        const writes = d.published.length;
        const r = await d.dispatcher.handlePackages(`/${source.id}/duplicate`, 'POST', { targetPackageId: PAIR_ID }, {}, ctx(ADMIN)) as any;
        expectRefusal(r, 400, 'VALIDATION_ERROR', `Package '${PAIR_ID}' is the paired customization package of '${CRM.id}'`, ENSURE_PATH.replace('POST ', ''));
        expect(rowsRead).toBe(0);
        expect(d.registry.getPackage(PAIR_ID)).toBeUndefined();
        expect(d.published).toHaveLength(writes);
    });
});
