// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A kernel booted from a MERGED artifact lists each package with the origin
 * its artifact entry states (`ArtifactPackageSchema.source`).
 *
 * The producer this serves is a control plane that folds an environment's
 * marketplace installs into the one artifact the environment boots from,
 * beside the environment's own code. It boots that artifact through
 * `AppPlugin` → the `manifest` service → `ObjectQL.registerApp`, the door the
 * deployment's own code uses, whose default is `code` — so without a per-entry
 * statement every such package was served as `code`, and Setup's marketplace
 * filter (`source === 'marketplace'` on the `GET /packages` row) showed none.
 *
 * Driven end to end on the real chain: a real kernel, the real `AppPlugin` and
 * `ObjectQLPlugin`, and the real dispatcher's `GET /packages` over the engine
 * that boot produced.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { ListInstalledPackagesResponseSchema } from '@objectstack/spec/api-assembled';
import { AppPlugin } from '../app-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const HOST = 'com.example.merged.host';
const INSTALLED = 'com.example.merged.installed';

const body = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'app' });

const kernels: LiteKernel[] = [];

afterEach(async () => {
    while (kernels.length) await kernels.pop()!.shutdown();
});

/** Boot `artifact` through `AppPlugin`, and answer `GET /packages` over the engine it produced. */
async function listBootedFrom(artifact: Record<string, unknown>): Promise<Record<string, unknown>> {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    kernels.push(kernel);
    kernel.use(new ObjectQLPlugin({}));
    kernel.use(new AppPlugin(artifact));
    await kernel.bootstrap();

    // The route reads `.registry` and `.manifests` off the engine slot — the
    // same handle `packages-writable-verdict.test.ts` hands it.
    const objectql = kernel.getService<ObjectQL>('objectql');
    const dispatcher = new HttpDispatcher({ context: { getService: (name: string) => (name === 'objectql' ? objectql : null) } } as any);
    const r = await dispatcher.handlePackages('/', 'GET', undefined, {}, {
        request: {},
        environmentId: 'pkg-artifact-entry-source-test',
        executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
    } as any);
    expect(r.response?.status ?? 200).toBe(200);
    // The served body is the declared contract, `source` included.
    const rows = ListInstalledPackagesResponseSchema.parse(r.response?.body).data.packages;
    return Object.fromEntries(rows
        .filter((row) => row.manifest.id === HOST || row.manifest.id === INSTALLED)
        .map((row) => [row.manifest.id, row.source]));
}

describe('GET /packages on a kernel booted from a merged artifact', () => {
    it('lists a package whose entry states marketplace as marketplace, beside the code package that states nothing', async () => {
        const sources = await listBootedFrom({
            ...body(HOST, 'mergedhost'),
            packages: [
                { manifest: body(HOST, 'mergedhost') },
                { manifest: body(INSTALLED, 'mergedinst'), source: 'marketplace' },
            ],
        });
        expect(sources).toEqual({ [HOST]: 'code', [INSTALLED]: 'marketplace' });
    });

    it('CONTROL: packages whose entries state no source keep today\'s behaviour — code', async () => {
        const sources = await listBootedFrom({
            ...body(HOST, 'mergedhost'),
            packages: [
                { manifest: body(HOST, 'mergedhost') },
                { manifest: body(INSTALLED, 'mergedinst') },
            ],
        });
        expect(sources).toEqual({ [HOST]: 'code', [INSTALLED]: 'code' });
    });
});
