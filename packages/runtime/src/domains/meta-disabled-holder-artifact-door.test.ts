// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32183, contract review M4] A compiled artifact whose `packages[]` carries
// two package bodies that both ship one dashboard and one agent, one package
// disabled: every bare door (the plain read, `/layers`, `/published`) serves
// the enabled holder's item on both transports, whichever body registered
// last.
//
// The artifact door registers every body's items in the metadata service. Its
// manager stores an `agent` per `(package, name)` and a `dashboard` by name
// alone, so for the dashboard it keeps the body registered last. The layered
// read's code layer asks that service first, and `/published` falls back to
// it. Booted the way `createStandaloneStack` composes a compiled artifact: the
// artifact door (`MetadataPlugin`'s `artifactSource`) and an `AppPlugin` over
// the same bundle. Driven through `HttpDispatcher.dispatch` and `RestServer`'s
// registered handlers, over the kernel's own protocol.
//
// Contract review M4 (branch head 1559964b, measured on this rig before the
// fix): with the disabled body registered last, the dashboard's bare
// `/layers` served its code layer and `/published` its body, on both
// transports; the agent's `/published` was refused `409` naming the disabled
// package, in both orders.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin, type MetadataManager } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { RestServer } from '@objectstack/rest';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';
import { AppPlugin } from '../app-plugin.js';
import { loadArtifactBundle } from '../load-artifact-bundle.js';

const CALLER = { userId: 'u_artifact_holders', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
const ENABLED = 'com.qa.alpha';
const DISABLED = 'com.qa.beta';
const tag = (id: string) => (id === DISABLED ? 'disabled' : 'enabled');

/** One assembled package body: a dashboard (stored by name) and an agent (stored per package). */
const bodyOf = (id: string) => ({
    manifest: {
        id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app',
        dashboards: [{ name: 'mix_dash', label: `${tag(id)} code`, widgets: [] }],
        agents: [{ name: 'mix_agent', label: `${tag(id)} code`, role: 'assistant', instructions: `${tag(id)} instructions` }],
    },
});

/** [type, name] — one type the metadata manager keys by name, one it keys by package. */
const SPECIMENS = [['dashboard', 'mix_dash'], ['agent', 'mix_agent']] as const;

interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }

async function bootArtifactKernel(order: readonly string[], body: (id: string) => unknown = bodyOf): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-artifact-holders-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    const artifact = join(root, 'objectstack.json');
    writeFileSync(artifact, JSON.stringify({
        manifest: { id: 'com.qa.host', name: 'host', version: '0.0.1', type: 'app' },
        objects: [], views: [], apps: [], flows: [], requires: [],
        packages: order.map(body),
    }));
    await kernel.use(new MetadataPlugin({ watch: false, artifactWatch: false, artifactSource: { mode: 'local-file', path: artifact }, rootDir: root } as any));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const bundle = await loadArtifactBundle(artifact, { tag: '[#32183 rig]', unwrapEnvelope: true });
    await kernel.use(new AppPlugin(bundle, undefined, { skipSeedData: true, securityMetadataRegistrar: 'artifact-door' }));
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine, root };
}

const errorCodeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

/** One bare door's answer on the runtime dispatcher. */
async function viaDispatcher(kernel: ObjectKernel, path: string, query: Record<string, string> = {}) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    try {
        const out: any = await dispatcher.dispatch('GET', path, {}, query, { request: new Request(`http://localhost/api/v1${path}`) } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, body: out.response?.body?.data ?? out.response?.body };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, body: { code: thrown.code, message: String((e as Error)?.message ?? '') } };
    }
}

/** One bare door's answer on `RestServer`, through its registered handler. */
async function viaRest(booted: Booted, route: string, params: Record<string, string>, query: Record<string, string> = {}) {
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, booted.kernel.getService('protocol') as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => ({ ...CALLER });
    rest.objectQLProvider = async () => booted.engine;
    rest.metadataServiceProvider = async () => booted.kernel.getService('metadata');
    rest.registerRoutes();
    const handler = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `/api/v1${route}`)?.handler;
    expect(handler, `precondition: RestServer registers GET ${route}`).toBeTruthy();
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (out: unknown) => { res.body = out; return res; };
    res.header = () => res; res.setHeader = noop; res.send = () => res; res.end = () => res;
    await handler({ method: 'GET', path: `/api/v1${route}`, params, headers: {}, query }, res);
    return { status: res.statusCode as number, body: res.body?.data ?? res.body };
}

/** The plain read, `/layers` and `/published` of one name, on both transports. */
async function bareDoors(booted: Booted, type: string, name: string) {
    const answers: Array<{ door: string; status: number | undefined; body: any }> = [];
    for (const [suffix, route] of [['', '/meta/:type/:name'], ['/layers', '/meta/:type/:name/layers'], ['/published', '/meta/:type/:name/published']] as const) {
        answers.push({ door: `dispatcher ${type}/${name}${suffix}`, ...(await viaDispatcher(booted.kernel, `/meta/${type}/${name}${suffix}`)) });
        answers.push({ door: `rest ${type}/${name}${suffix}`, ...(await viaRest(booted, route, { type, name })) });
    }
    return answers;
}

describe.each([
    { order: 'the disabled body registered last', packages: [ENABLED, DISABLED] },
    { order: 'the enabled body registered last', packages: [DISABLED, ENABLED] },
])('[#32183 M4] the artifact door: two package bodies ship one name, one disabled, $order', ({ packages }) => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootArtifactKernel(packages);
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('the fixture: the metadata service keeps the dashboard registered last, and holds an agent per package', async () => {
        const service = booted!.kernel.getService<MetadataManager>('metadata');
        const stampOf = (item: unknown) => (item as { _packageId?: unknown } | undefined)?._packageId;
        expect(stampOf(await service.get('dashboard', 'mix_dash'))).toBe(packages[packages.length - 1]);
        for (const id of packages) expect(stampOf(await service.get('agent', 'mix_agent', id))).toBe(id);
    });

    it('CONTROL: both enabled, every bare door refuses 409 naming both', async () => {
        for (const [type, name] of SPECIMENS) {
            for (const answer of await bareDoors(booted!, type, name)) {
                expect([answer.status, errorCodeOf(answer.body), answer.door], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', answer.door]);
            }
        }
    });

    it('one disabled: the plain read, /layers and /published serve the enabled holder\'s item on both transports; re-enabled, refused again', async () => {
        booted!.engine.registry.disablePackage(DISABLED);
        try {
            for (const [type, name] of SPECIMENS) {
                for (const answer of await bareDoors(booted!, type, name)) {
                    expect(answer.status, `${answer.door} ${JSON.stringify(answer.body)}`).toBe(200);
                    const label = answer.door.endsWith('/layers')
                        ? [answer.body?.code?.label, answer.body?.effective?.label]
                        : [answer.body?.item?.label ?? answer.body?.label];
                    expect([...label, answer.door]).toEqual([...label.map(() => 'enabled code'), answer.door]);
                    expect(JSON.stringify(answer.body ?? null), answer.door).not.toMatch(/disabled (code|instructions)/);
                }
            }
        } finally {
            booted!.engine.registry.enablePackage(DISABLED);
        }
        for (const [type, name] of SPECIMENS) {
            const again = await viaDispatcher(booted!.kernel, `/meta/${type}/${name}`);
            expect([again.status, errorCodeOf(again.body)], JSON.stringify(again.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        }
    });
});

// [#34040, ADR-0150 D3, red line 2] The exact address of a `doc`, on the same
// composed rig. The artifact door's manager keeps a `doc` by name alone (the
// body registered last), and the by-name read asked it before the registry, so
// `GET /meta/doc/NAME?package=X` answered the other body whenever it registered
// last. Measured on this rig before the fix (origin/main 63db7240): `?package=`
// of the body registered first answered the last one's doc, on both transports.
const ALPHA = 'com.qa.alpha';
const BETA = 'com.qa.beta';
const docBodyOf = (ids: readonly string[]) => (id: string) => ({
    manifest: {
        id, name: id.split('.').pop(), namespace: id.split('.').pop(), version: '1.0.0', type: 'app',
        docs: ids.includes(id) ? [{ name: 'shared_doc', label: `${id.split('.').pop()} doc`, content: `# ${id.split('.').pop()}` }] : [],
    },
});

/** The plain read of one doc at `?package=`, on both transports. */
async function exactDocDoors(booted: Booted, packageId: string) {
    const query = { package: packageId };
    return [
        { door: `dispatcher doc/shared_doc?package=${packageId}`, ...(await viaDispatcher(booted.kernel, '/meta/doc/shared_doc', query)) },
        { door: `rest doc/shared_doc?package=${packageId}`, ...(await viaRest(booted, '/meta/:type/:name', { type: 'doc', name: 'shared_doc' }, query)) },
    ];
}

describe.each([
    { order: 'alpha registered first', packages: [ALPHA, BETA] },
    { order: 'beta registered first', packages: [BETA, ALPHA] },
])('[#34040] the artifact door: two package bodies ship one doc name, $order', ({ packages }) => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootArtifactKernel(packages, docBodyOf([ALPHA, BETA]));
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('the fixture: the metadata service keeps the doc of the body registered last', async () => {
        const service = booted!.kernel.getService<MetadataManager>('metadata');
        expect((await service.get('doc', 'shared_doc') as { _packageId?: unknown } | undefined)?._packageId).toBe(packages[packages.length - 1]);
    });

    it('`?package=X` answers X\'s own doc on both transports, for each holder, never the other\'s', async () => {
        for (const [packageId, label, other] of [[ALPHA, 'alpha doc', 'beta'], [BETA, 'beta doc', 'alpha']] as const) {
            for (const answer of await exactDocDoors(booted!, packageId)) {
                const item = answer.body?.item ?? answer.body;
                expect([answer.status, item?.label, item?._packageId, answer.door], JSON.stringify(answer.body)).toEqual([200, label, packageId, answer.door]);
                expect(JSON.stringify(answer.body ?? null), answer.door).not.toContain(`# ${other}`);
            }
        }
    });
});

describe('[#34040] CONTROL — one body ships the doc: its exact address answers it, unchanged', () => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootArtifactKernel([ALPHA, BETA], docBodyOf([ALPHA]));
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('`?package=alpha` answers alpha\'s doc on both transports', async () => {
        for (const answer of await exactDocDoors(booted!, ALPHA)) {
            const item = answer.body?.item ?? answer.body;
            expect([answer.status, item?.label, answer.door], JSON.stringify(answer.body)).toEqual([200, 'alpha doc', answer.door]);
        }
    });
});

// [#34247, ADR-0150 D3/D5, red line 2] The exact address of a doc the package
// it names ships none of, on the same rig: 404 on the plain read and `/layers`,
// never another holder's doc. BASE (origin/main 01598d93, PR #34241 merged):
// `?package=` of a package that ships no doc of the name (installed, or not
// installed at all) answered 200 with a holder's doc on both transports and on
// both doors (the first registered after the step-2 decline, else the service's
// copy); `/layers?package=alpha` answered beta's code and effective layers even
// where alpha ships the doc, whenever beta registered last.
const GAMMA = 'com.qa.gamma';
const NOT_INSTALLED = 'com.qa.unknown';

/** The plain read and `/layers` of the doc at `?package=`, on both transports. */
async function exactDocAndLayers(booted: Booted, packageId: string) {
    const query = { package: packageId };
    return [
        ...(await exactDocDoors(booted, packageId)),
        { door: `dispatcher doc/shared_doc/layers?package=${packageId}`, ...(await viaDispatcher(booted.kernel, '/meta/doc/shared_doc/layers', query)) },
        { door: `rest doc/shared_doc/layers?package=${packageId}`, ...(await viaRest(booted, '/meta/:type/:name/layers', { type: 'doc', name: 'shared_doc' }, query)) },
    ];
}

describe.each([
    { order: 'alpha registered first, both ship', packages: [ALPHA, BETA, GAMMA], ships: [ALPHA, BETA] },
    { order: 'beta registered first, both ship', packages: [BETA, ALPHA, GAMMA], ships: [ALPHA, BETA] },
    { order: 'alpha registered first, beta alone ships', packages: [ALPHA, BETA, GAMMA], ships: [BETA] },
    { order: 'beta registered first, beta alone ships', packages: [BETA, ALPHA, GAMMA], ships: [BETA] },
])('[#34247] the artifact door: the exact address of a doc its package ships none of, $order', ({ packages, ships }) => {
    let booted: Booted | undefined;

    beforeAll(async () => {
        booted = await bootArtifactKernel(packages, docBodyOf(ships));
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    it('`?package=` of a package shipping none (installed or not) answers 404 on the plain read and /layers, both transports, never a holder\'s doc', async () => {
        const nonHolders = [ALPHA, GAMMA, NOT_INSTALLED].filter((id) => !ships.includes(id));
        for (const packageId of nonHolders) {
            for (const answer of await exactDocAndLayers(booted!, packageId)) {
                expect([answer.status, errorCodeOf(answer.body), answer.door], JSON.stringify(answer.body)).toEqual([404, 'RESOURCE_NOT_FOUND', answer.door]);
                expect(JSON.stringify(answer.body ?? null), answer.door).not.toMatch(/(alpha|beta) doc/);
            }
        }
    });

    it('CONTROL: each holder\'s address answers its own doc on the plain read and /layers (code and effective), both transports', async () => {
        for (const packageId of ships) {
            const label = `${packageId.split('.').pop()} doc`;
            for (const answer of await exactDocAndLayers(booted!, packageId)) {
                const served = answer.door.includes('/layers')
                    ? [answer.body?.code?.label, answer.body?.effective?.label]
                    : [(answer.body?.item ?? answer.body)?.label];
                expect([answer.status, ...served, answer.door], JSON.stringify(answer.body)).toEqual([200, ...served.map(() => label), answer.door]);
            }
        }
    });
});

// [#34040 acceptance item 4, review-c N2/N6 on PR #34036] The bare doc read's
// refusal on the same composed rig, and the two package-less registry entries
// beside two enabled holders. A hydrated row is laid as the hydrator lays it:
// the stored `sys_metadata` row, and its package-less copy in the registry's
// bare slot (stamped with the `sys_metadata` sentinel).
//
// Measured on this rig (origin/main 86350e12, PR #34036 merged): with either
// entry the bare doors do not answer the environment's item; they answer the
// holder the metadata service registered last (a registration-order pick),
// and `/layers` reports the row as the overlay over that holder's effective
// item. Pinned as measured, unresolved: a follow-up decides that answer.
const layEnvironmentDocRow = (engine: ObjectQL) => engine.insert('sys_metadata', {
    type: 'doc', name: 'shared_doc', namespace: 'default', package_id: null, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
    metadata: JSON.stringify({ name: 'shared_doc', label: 'environment doc', content: '# env' }),
}, { context: { isSystem: true } } as any);
const docRegistryOf = (booted: Booted) => (booted.engine.registry as unknown as { metadata: Map<string, Map<string, unknown>> }).metadata.get('doc')!;
const labelAt = (door: string, body: any) => (door.endsWith('/layers') ? [body?.overlay?.label, body?.effective?.label] : [body?.item?.label ?? body?.label]);

describe.each([
    { order: 'alpha registered first', packages: [ALPHA, BETA] },
    { order: 'beta registered first', packages: [BETA, ALPHA] },
])('[#34040 item 4] the bare doc doors beside two enabled holders of one doc name, $order', ({ packages }) => {
    let booted: Booted | undefined;
    const last = packages[packages.length - 1]!;
    const lastDoc = `${last.split('.').pop()} doc`;

    beforeAll(async () => {
        booted = await bootArtifactKernel(packages, docBodyOf([ALPHA, BETA]));
    }, 120_000);

    afterAll(async () => {
        if (!booted) return;
        if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
        rmSync(booted.root, { recursive: true, force: true });
    });

    const expectRefusedNamingBoth = async () => {
        for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
            expect([answer.status, errorCodeOf(answer.body), answer.door], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', answer.door]);
            for (const id of [ALPHA, BETA]) expect(JSON.stringify(answer.body ?? null), answer.door).toContain(id);
        }
    };
    const expectExactReadsOwnDoc = async () => {
        for (const [packageId, label] of [[ALPHA, 'alpha doc'], [BETA, 'beta doc']] as const) {
            for (const answer of await exactDocDoors(booted!, packageId)) {
                const item = answer.body?.item ?? answer.body;
                expect([answer.status, item?.label, item?._packageId, answer.door], JSON.stringify(answer.body)).toEqual([200, label, packageId, answer.door]);
            }
        }
    };

    it('no package-less entry: the plain read, /layers and /published refuse 409 naming both, on both transports; each exact address reads its own doc', async () => {
        await expectRefusedNamingBoth();
        await expectExactReadsOwnDoc();
    });

    it('(measured, unresolved) a stamp-less bare entry with the service\'s copy: the bare doors serve the holder registered last; each exact address reads its own doc', async () => {
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'bare entry', content: '# bare' } as never, 'name' as never);
        try {
            for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
                expect([answer.status, ...labelAt(answer.door, answer.body), answer.door], JSON.stringify(answer.body))
                    .toEqual([200, ...(answer.door.endsWith('/layers') ? [undefined, lastDoc] : [lastDoc]), answer.door]);
            }
            await expectExactReadsOwnDoc();
        } finally {
            docRegistryOf(booted!).delete('shared_doc');
        }
    });

    it('(measured, unresolved) a hydrated package-less row: the bare doors serve the holder registered last, /layers that holder under the row; each exact address reads its own doc', async () => {
        await layEnvironmentDocRow(booted!.engine);
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'environment doc', content: '# env', _packageId: 'sys_metadata' } as never, 'name' as never);
        for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
            expect([answer.status, ...labelAt(answer.door, answer.body), answer.door], JSON.stringify(answer.body))
                .toEqual([200, ...(answer.door.endsWith('/layers') ? ['environment doc', lastDoc] : [lastDoc]), answer.door]);
        }
        await expectExactReadsOwnDoc();
        // The row alone, its registry copy gone: no exemption, refused again.
        docRegistryOf(booted!).delete('shared_doc');
        await expectRefusedNamingBoth();
    });
});
