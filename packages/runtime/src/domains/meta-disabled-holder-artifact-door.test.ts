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

async function bootArtifactKernel(order: readonly string[]): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-artifact-holders-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    const artifact = join(root, 'objectstack.json');
    writeFileSync(artifact, JSON.stringify({
        manifest: { id: 'com.qa.host', name: 'host', version: '0.0.1', type: 'app' },
        objects: [], views: [], apps: [], flows: [], requires: [],
        packages: order.map(bodyOf),
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
async function viaDispatcher(kernel: ObjectKernel, path: string) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    try {
        const out: any = await dispatcher.dispatch('GET', path, {}, {}, { request: new Request(`http://localhost/api/v1${path}`) } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, body: out.response?.body?.data ?? out.response?.body };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, body: { code: thrown.code, message: String((e as Error)?.message ?? '') } };
    }
}

/** One bare door's answer on `RestServer`, through its registered handler. */
async function viaRest(booted: Booted, route: string, params: Record<string, string>) {
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
    await handler({ method: 'GET', path: `/api/v1${route}`, params, headers: {}, query: {} }, res);
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
