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

    // [ruling 6917064203 on #34398] Refused naming the holders, as the exact
    // qualifier refuses the covered types; a qualifier that names no
    // installed package (the Console's app-name segment) is answered the same.
    it('`?package=` of a package shipping none (installed or not) is refused 409 `not-held-by-qualifier` naming the holders on the plain read and /layers, both transports, never a holder\'s doc', async () => {
        const nonHolders = [ALPHA, GAMMA, NOT_INSTALLED].filter((id) => !ships.includes(id));
        for (const packageId of nonHolders) {
            for (const answer of await exactDocAndLayers(booted!, packageId)) {
                const body = JSON.stringify(answer.body ?? null);
                const details = answer.body?.error && typeof answer.body.error === 'object' ? answer.body.error.details : answer.body?.details;
                const named = ((details?.candidates ?? []) as Array<{ kind?: string; packageId?: string }>).map((c) => `${c.kind}:${c.packageId}`).sort();
                expect([answer.status, errorCodeOf(answer.body), named, answer.door], body)
                    .toEqual([409, 'RESOURCE_CONFLICT', ships.map((holder) => `package:${holder}`).sort(), answer.door]);
                expect(body, answer.door).not.toMatch(/(alpha|beta) doc|# (alpha|beta)/);
            }
        }
    });

    it('CONTROL: a doc name no package ships is the read\'s own 404 at any package address, both transports', async () => {
        for (const packageId of [ALPHA, GAMMA, NOT_INSTALLED]) {
            const query = { package: packageId };
            for (const answer of [
                { door: `dispatcher doc/no_such_doc?package=${packageId}`, ...(await viaDispatcher(booted!.kernel, '/meta/doc/no_such_doc', query)) },
                { door: `rest doc/no_such_doc?package=${packageId}`, ...(await viaRest(booted!, '/meta/:type/:name', { type: 'doc', name: 'no_such_doc' }, query)) },
            ]) {
                expect([answer.status, errorCodeOf(answer.body), answer.door], JSON.stringify(answer.body)).toEqual([404, 'RESOURCE_NOT_FOUND', answer.door]);
            }
        }
    });

    it.runIf(ships.length === 1)('CONTROL [#34248]: one holder\'s doc is what the bare plain read, /layers and /published serve, both transports', async () => {
        const label = `${ships[0]!.split('.').pop()} doc`;
        for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
            const served = answer.door.endsWith('/layers') ? answer.body?.effective?.label : (answer.body?.item ?? answer.body)?.label;
            expect([answer.status, served, answer.door], JSON.stringify(answer.body)).toEqual([200, label, answer.door]);
        }
    });

    // [review S1] Measured, unresolved: the environment's entry answers first
    // only beside two or more enabled holders (#34248's acceptance). Beside
    // one holder, the registry (and so `MetadataFacade.get`) answers a
    // stamp-less bare entry while the bare doors keep the holder's doc, as on
    // main. Declared in the changeset; a second holder flips the doors to the
    // entry (the #34248 pins below).
    it.runIf(ships.length === 1)('[measured, unresolved] one holder beside a stamp-less bare entry: the bare doors serve the holder\'s doc on both transports while the registry answers the entry', async () => {
        const label = `${ships[0]!.split('.').pop()} doc`;
        const bareSlot = (booted!.engine.registry as unknown as { metadata: Map<string, Map<string, unknown>> }).metadata.get('doc')!;
        const before = bareSlot.has('shared_doc') ? { held: bareSlot.get('shared_doc') } : undefined;
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'bare entry', content: '# bare' } as never, 'name' as never);
        try {
            expect((booted!.engine.registry.resolveItem('doc', 'shared_doc', null) as { label?: string } | undefined)?.label).toBe('bare entry');
            for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
                const served = answer.door.endsWith('/layers') ? answer.body?.effective?.label : (answer.body?.item ?? answer.body)?.label;
                expect([answer.status, served, answer.door], JSON.stringify(answer.body)).toEqual([200, label, answer.door]);
            }
        } finally {
            if (before) bareSlot.set('shared_doc', before.held);
            else bareSlot.delete('shared_doc');
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
// beside two enabled holders. A hydrated row is laid as the hydrator lays it
// when it reads the row before any package ships the name (a doc saved, then
// two packages that ship it installed): the stored `sys_metadata` row, and in
// the registry's bare slot the body `hydrateOverlayIntoRegistry` registers,
// `stateTenantAuthorship(withRowBinding(body, null))`: no `_packageId`,
// `_provenance: 'org'`. With the artifacts read first, the hydrator grafts the
// first holder's envelope onto the row instead (the last pin below).
//
// [#34248, ruling 6893582352] Either entry is the environment's own item, and
// the environment's own item answers first: the bare doors serve it (the plain
// read and `/published` its body, `/layers` the entry as the code layer and
// effective, a stored row also as the overlay), never the holder the
// metadata service registered last. Without such an entry the bare doors
// refuse 409 naming both (PR #34036). BASE (origin/main 01598d93, PR #34241
// merged): with either entry the bare doors answered the holder the metadata
// service registered last (a registration-order pick), and `/layers` reported
// the row as the overlay over that holder's effective item.
const layEnvironmentDocRow = (engine: ObjectQL) => engine.insert('sys_metadata', {
    type: 'doc', name: 'shared_doc', namespace: 'default', package_id: null, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
    metadata: JSON.stringify({ name: 'shared_doc', label: 'environment doc', content: '# env' }),
}, { context: { isSystem: true } } as any);
const docRegistryOf = (booted: Booted) => (booted.engine.registry as unknown as { metadata: Map<string, Map<string, unknown>> }).metadata.get('doc')!;

describe.each([
    { order: 'alpha registered first', packages: [ALPHA, BETA] },
    { order: 'beta registered first', packages: [BETA, ALPHA] },
])('[#34040 item 4] the bare doc doors beside two enabled holders of one doc name, $order', ({ packages }) => {
    let booted: Booted | undefined;
    const last = packages[packages.length - 1]!;
    const lastDoc = `${last.split('.').pop()} doc`;

    // The environment's package-less stored row, laid once per kernel (the
    // pins below read it in turn).
    let rowLaid = false;
    const layRowOnce = async () => {
        if (rowLaid) return;
        await layEnvironmentDocRow(booted!.engine);
        rowLaid = true;
    };

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

    /** Each bare door's answer: the plain read and `/published` the item, `/layers` its code, overlay and effective layers. */
    const expectBareDoorsServe = async (expected: { item: string; code: string | undefined; overlay: string | undefined }) => {
        for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
            const served = answer.door.endsWith('/layers')
                ? [answer.body?.code?.label, answer.body?.overlay?.label, answer.body?.effective?.label]
                : [(answer.body?.item ?? answer.body)?.label];
            const want = answer.door.endsWith('/layers') ? [expected.code, expected.overlay, expected.item] : [expected.item];
            expect([answer.status, ...served, answer.door], JSON.stringify(answer.body)).toEqual([200, ...want, answer.door]);
            expect(JSON.stringify(answer.body ?? null), answer.door).not.toContain(lastDoc);
        }
    };

    it('CONTROL [#34248]: a package-less doc no package ships is what the bare plain read, /layers and /published serve, both transports', async () => {
        await booted!.kernel.getService<MetadataManager>('metadata').register('doc', 'env_only_doc', { name: 'env_only_doc', label: 'env only doc', content: '# env only' });
        for (const answer of await bareDoors(booted!, 'doc', 'env_only_doc')) {
            const served = answer.door.endsWith('/layers') ? answer.body?.effective?.label : (answer.body?.item ?? answer.body)?.label;
            expect([answer.status, served, answer.door], JSON.stringify(answer.body)).toEqual([200, 'env only doc', answer.door]);
        }
    });

    it('[#34248] a stamp-less bare entry with the service\'s copy: the plain read, /layers (its code layer) and /published serve the entry on both transports, never the holder registered last; each exact address reads its own doc', async () => {
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'bare entry', content: '# bare' } as never, 'name' as never);
        try {
            await expectBareDoorsServe({ item: 'bare entry', code: 'bare entry', overlay: undefined });
            await expectExactReadsOwnDoc();
        } finally {
            docRegistryOf(booted!).delete('shared_doc');
        }
        // The entry gone: refused again.
        await expectRefusedNamingBoth();
    });

    // [review M1] The hydrator's entry is tenant-authored, so it is no code
    // layer (#21059): `code` is null, and the row is the overlay and the
    // effective layer. Measured at 989f4ad7 before the fix: the plain read
    // served the row while `/layers` answered `effective: null` (the sealed
    // doc's row declined) and both `/published` doors served an empty body.
    it('[#34248] a hydrated package-less row (hydrated before the artifacts): the plain read, /layers (no code layer, the row as overlay and effective) and /published serve the row on both transports, never the holder registered last; each exact address reads its own doc', async () => {
        await layRowOnce();
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'environment doc', content: '# env', _provenance: 'org' } as never, 'name' as never);
        await expectBareDoorsServe({ item: 'environment doc', code: undefined, overlay: 'environment doc' });
        await expectExactReadsOwnDoc();
        // The row alone, its registry copy gone: no exemption, refused again.
        docRegistryOf(booted!).delete('shared_doc');
        await expectRefusedNamingBoth();
    });

    // [review S4] A stamp-less runtime registration in the bare slot beside a
    // DIFFERENT package-less stored row: the entry is a code layer, not the
    // row's tenant-authored copy, so the row is no effective layer here and
    // all three doors serve the entry, the row reported as `overlay` (as at
    // 989f4ad7, before the hydrated row's rule was added).
    it('[#34248] a stamp-less bare entry beside a different package-less stored row: the plain read, /layers (the entry as code and effective, the row as overlay) and /published serve the entry on both transports', async () => {
        await layRowOnce();
        booted!.engine.registry.registerItem('doc', { name: 'shared_doc', label: 'bare entry', content: '# bare' } as never, 'name' as never);
        try {
            await expectBareDoorsServe({ item: 'bare entry', code: 'bare entry', overlay: 'environment doc' });
            await expectExactReadsOwnDoc();
        } finally {
            docRegistryOf(booted!).delete('shared_doc');
        }
    });

    // [review M1] The same stored row hydrated by the production read
    // (`loadMetaFromDb`) after the artifacts registered: the hydrator grafts
    // the first holder's envelope onto it, so no package-less entry exists
    // and every bare door refuses naming both, as on main (measured at
    // origin/main c9346317 and at this head). The other holder's address
    // reads its own doc.
    it('CONTROL [#34248]: the row hydrated after the artifacts (`loadMetaFromDb`) wears the first holder\'s envelope, and the bare doors refuse 409 naming both on both transports', async () => {
        await layRowOnce();
        const hydrated = await (booted!.kernel.getService('protocol') as { loadMetaFromDb(): Promise<{ loaded: number; errors: number }> }).loadMetaFromDb();
        expect([hydrated.loaded > 0, hydrated.errors]).toEqual([true, 0]);
        const entry = docRegistryOf(booted!).get('shared_doc') as { _packageId?: unknown; _provenance?: unknown } | undefined;
        expect([entry?._packageId, entry?._provenance]).toEqual([packages[0], 'package']);
        await expectRefusedNamingBoth();
        const second = packages[1]!;
        for (const answer of await exactDocDoors(booted!, second)) {
            expect([answer.status, (answer.body?.item ?? answer.body)?.label, answer.door], JSON.stringify(answer.body))
                .toEqual([200, `${second.split('.').pop()} doc`, answer.door]);
        }
        docRegistryOf(booted!).delete('shared_doc');
    });
});

// [#34041, ADR-0150 D3] A disabled package holds no name, so beside one
// enabled holder of a doc every bare door serves that holder's doc. The
// artifact door's manager keeps a `doc` by name alone (the body registered
// last), and the read naming no package was re-addressed to the served holder
// only for a type the registry reads by package (`servedHolderAddressOf`), so
// the service's copy, the disabled body's when it registered last, was the
// layer read and then withheld. Measured on this rig before the fix
// (origin/main 01598d93): with beta disabled and registered last, the plain
// read, `/layers` and `/published` answered 404 on both transports.
describe.each([
    { order: 'the disabled holder registered last', packages: [ALPHA, BETA] },
    { order: 'the disabled holder registered first', packages: [BETA, ALPHA] },
])('[#34041] the bare doc doors beside one enabled and one disabled holder of one doc name, $order', ({ packages }) => {
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

    it('beta disabled: the plain read, /layers and /published serve alpha\'s doc on both transports, never beta\'s', async () => {
        booted!.engine.registry.disablePackage(BETA);
        try {
            const answers = await bareDoors(booted!, 'doc', 'shared_doc');
            // Every door at once, so a red names each door that answered otherwise.
            expect(answers.map((answer) => [answer.door, answer.status, ...(answer.door.endsWith('/layers')
                ? [answer.body?.code?.label, answer.body?.effective?.label]
                : [answer.body?.item?.label ?? answer.body?.label])]))
                .toEqual(answers.map((answer) => [answer.door, 200, ...(answer.door.endsWith('/layers') ? ['alpha doc', 'alpha doc'] : ['alpha doc'])]));
            for (const answer of answers) expect(JSON.stringify(answer.body ?? null), answer.door).not.toContain('# beta');
        } finally {
            booted!.engine.registry.enablePackage(BETA);
        }
    });

    it('CONTROL: both disabled, every bare door answers 404; both enabled again, every bare door refuses 409 naming both', async () => {
        booted!.engine.registry.disablePackage(ALPHA);
        booted!.engine.registry.disablePackage(BETA);
        try {
            const answers = await bareDoors(booted!, 'doc', 'shared_doc');
            expect(answers.map((answer) => [answer.door, answer.status])).toEqual(answers.map((answer) => [answer.door, 404]));
            for (const answer of answers) expect(JSON.stringify(answer.body ?? null), answer.door).not.toMatch(/# (alpha|beta)/);
        } finally {
            booted!.engine.registry.enablePackage(ALPHA);
            booted!.engine.registry.enablePackage(BETA);
        }
        for (const answer of await bareDoors(booted!, 'doc', 'shared_doc')) {
            expect([answer.status, errorCodeOf(answer.body), answer.door], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', answer.door]);
            for (const id of [ALPHA, BETA]) expect(JSON.stringify(answer.body ?? null), answer.door).toContain(id);
        }
    });
});
