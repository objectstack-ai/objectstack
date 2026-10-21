// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// MEASUREMENT SCAFFOLD — rewritten into the pin before commit.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { refuseUnexposedDataAction } from '../action-execution.js';

const PKG = 'com.qa.pkgobj';
const OPEN = 'qa_pkg_open';
const GATED = 'qa_pkg_gated';

const pkgArtifact = () => ({
    id: PKG,
    name: 'qa pkg',
    version: '1.0.0',
    type: 'app',
    objects: [
        { name: OPEN, label: 'Open', fields: { name: { name: 'name', type: 'text', label: 'Name' } } },
        { name: GATED, label: 'Gated', enable: { apiEnabled: false }, fields: { name: { name: 'name', type: 'text', label: 'Name' } } },
    ],
});

const live: ObjectKernel[] = [];
const roots: string[] = [];
afterEach(async () => {
    while (live.length) {
        const k = live.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function boot(environmentId: string | undefined, when: 'boot' | 'late') {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    live.push(kernel);
    const root = mkdtempSync(join(tmpdir(), 'os-25120-'));
    roots.push(root);
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_r: Request, o: any) => {
            mcp.lastOpts = o;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    if (environmentId === undefined) {
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
    } else {
        const artifact = join(root, 'objectstack.json');
        writeFileSync(artifact, JSON.stringify({
            manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
            objects: [], views: [], apps: [], flows: [], requires: [],
        }));
        await kernel.use(new MetadataPlugin({
            watch: false, artifactWatch: false, environmentId,
            artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
        } as any));
        await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId, hydrateMetadataFromDb: true }));
    }
    await kernel.use({
        name: 'qa.package-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: any) => {
            ctx.registerService('mcp', mcp);
            if (when === 'boot') ctx.getService('manifest').register(pkgArtifact());
        },
    } as any);
    await kernel.bootstrap();
    if (when === 'late') await (kernel.getService('manifest') as any).register(pkgArtifact(), { source: 'marketplace' });
    await engine.syncSchemas();
    return { kernel, engine, mcp };
}

const ctx = (environmentId?: string): any => ({
    request: new Request('http://localhost/api/v1/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: '{}',
    }),
    response: {},
    environmentId,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [], systemPermissions: [] },
});

describe('measure', () => {
    for (const environmentId of [undefined, 'env_local']) {
        for (const when of ['boot', 'late'] as const) {
            it(`env=${environmentId ?? 'none'} when=${when}`, async () => {
                const { kernel, mcp } = await boot(environmentId, when);
                const meta: any = kernel.getService('metadata');
                const protocol: any = kernel.getService('protocol');
                const d = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
                const r = await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx());
                expect(r.response?.status).toBe(200);
                const bridge = mcp.lastOpts.bridge;
                const out: Record<string, unknown> = {};
                out.metaGetOpen = Boolean(await meta.getObject(OPEN));
                out.metaGetGated = Boolean(await meta.getObject(GATED));
                const metaNames = ((await meta.listObjects()) as any[]).map((o) => o.name);
                out.metaListHasPkg = metaNames.filter((n) => n === OPEN || n === GATED);
                const merged = await protocol.getMetaItems({ type: 'object' });
                const mergedNames = merged.items.map((o: any) => o.name);
                out.mergedHasPkg = mergedNames.filter((n: string) => n === OPEN || n === GATED);
                out.mergedNonSys = mergedNames.filter((n: string) => !/^sys_/i.test(n)).length;
                const listed = await bridge.listObjectsDiagnosed();
                out.mcpList = listed.objects.map((o: any) => o.name).filter((n: string) => !/^sys_/i.test(n));
                out.mcpDescribeOpen = Boolean(await bridge.describeObject(OPEN));
                const rest = await d.handleMetadata('/object', ctx(), 'GET');
                out.restStatus = rest.response?.status;
                const restItems = (rest.response?.body?.data?.items ?? rest.response?.body?.data ?? []) as any[];
                out.restNonSys = Array.isArray(restItems) ? restItems.filter((o: any) => !/^sys_/i.test(o?.name)).map((o: any) => o.name) : restItems;
                for (const verb of ['query', 'create'] as const) {
                    try {
                        if (verb === 'query') await bridge.query(GATED, {});
                        else await bridge.create(GATED, { name: 'x' });
                        out[`mcp_${verb}_gated`] = 'SERVED';
                    } catch (e: any) {
                        out[`mcp_${verb}_gated`] = `${e?.code ?? ''} ${e?.status ?? ''} ${String(e?.message).slice(0, 80)}`;
                    }
                }
                console.log(`READING env=${environmentId ?? 'none'} when=${when}`, JSON.stringify(out));
            }, 60_000);
        }
    }
});
