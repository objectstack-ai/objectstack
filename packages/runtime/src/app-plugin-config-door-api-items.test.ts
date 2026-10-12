// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22989: on a config boot, `AppPlugin` registers the stack's declared `apis`
 * into the metadata service, so the endpoint matcher serves them on this door
 * as it serves them on the artifact door.
 *
 * The matcher (`MetadataManager.matchEndpoint` -> `EndpointMatcher` ->
 * `listForIndex('api')`) reads the metadata service's own `api` items and
 * nothing else. The artifact door (`MetadataPlugin`, `ARTIFACT_FIELD_TO_TYPE`)
 * registers them there. The config door handed them to the `manifest` service
 * alone, which fills the ObjectQL registry the matcher never reads, so every
 * declared path answered the transport's `404 ENDPOINT_NOT_FOUND` on a config
 * boot while the built artifact of the same stack matched it.
 *
 * The composition below is the one `os serve objectstack.config.ts` assembles
 * for a stack with no plugin instances and no compiled artifact:
 * `createStandaloneStack` (which composes `MetadataPlugin`, finds no artifact,
 * and so pushes no `AppPlugin` of its own) followed by the CLI's
 * `new AppPlugin(config)` wrap, under the default registrar.
 *
 * The pins read the matcher seam, `matchEndpoint`, which is the one question
 * the HTTP endpoint step (`runAppEndpointStep`) asks before it answers 401 or
 * 404 for a declared path.
 *
 * Out of scope here, measured and reported on the card: a composition whose
 * `metadata` slot holds the kernel's in-memory fallback (a host config on
 * `os serve`) has no matcher at all, so these items are listed there and
 * none is served.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '@objectstack/core';
import { MetadataManager } from '@objectstack/metadata';
import { defineStack } from '@objectstack/spec';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the factory and the kernel boot below import them lazily, inside
// a clocked hook (`scripts/check-test-source-alias.mjs`, the clocked-window rule).
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const APP_ID = 'com.test.issue-22989';
const STAMPS = { _packageId: APP_ID, _packageVersion: '1.0.0', _provenance: 'package' } as const;
const FEED_PATH = '/api/v1/apps/probe/tasks';

const TASK_FEED = {
    name: 'probe_task_feed',
    path: FEED_PATH,
    method: 'GET',
    summary: 'Task feed',
    type: 'object_operation',
    objectParams: { object: 'probe_task', operation: 'find' },
    authRequired: true,
} as const;

/** The stack as an author writes it: what `objectstack.config.ts` default-exports. */
const authoredStack = () => ({
    manifest: {
        id: APP_ID,
        name: 'Config Door Api Probe',
        version: '1.0.0',
        type: 'app',
        // ADR-0121 D1: a declared path sits under `/api/v1/apps/<namespace>/`.
        namespace: 'probe',
    },
    objects: [
        {
            name: 'probe_task',
            label: 'Probe Task',
            fields: { title: { type: 'text', label: 'Title' } },
        },
    ],
    apis: [{ ...TASK_FEED, objectParams: { ...TASK_FEED.objectParams } }],
});

const BOOT_TIMEOUT = 120_000;

interface Booted {
    kernel: any;
    metadata: any;
    dir: string;
}

/** Boot `plugins` on a fresh kernel. */
async function bootPlugins(plugins: unknown[], dir: string): Promise<Booted> {
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    for (const p of plugins) await kernel.use(p as any);
    await kernel.bootstrap();
    return { kernel, metadata: kernel.getService('metadata'), dir };
}

/**
 * The config door: `os serve objectstack.config.ts` for a stack with no plugin
 * instances and no compiled artifact. Returns the module the wrap was handed,
 * so a pin can read it back.
 */
async function bootConfigDoor(tag: string, config: unknown): Promise<Booted> {
    const dir = mkdtempSync(join(tmpdir(), `os-22989-${tag}-`));
    const stack = await createStandaloneStack({
        // Named and absent: the artifact this door does not have.
        artifactPath: join(dir, 'dist', 'objectstack.json'),
        projectRoot: dir,
        databaseUrl: ':memory:',
        skipSeedData: true,
        runPlatformMigrations: false,
    });
    // CONTROL on the composition itself: no artifact loaded, so the standalone
    // stack carries no `AppPlugin`, and the CLI's wrap is the app's only one.
    expect(stack.plugins.some((p: any) => p instanceof AppPlugin)).toBe(false);
    return bootPlugins([...stack.plugins, new AppPlugin(config)], dir);
}

/** The artifact door: `createStandaloneStack` over the compiled twin of the same stack. */
async function bootArtifactDoor(tag: string, artifact: unknown): Promise<Booted> {
    const dir = mkdtempSync(join(tmpdir(), `os-22989-${tag}-`));
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');
    const stack = await createStandaloneStack({
        artifactPath,
        projectRoot: dir,
        databaseUrl: ':memory:',
        skipSeedData: true,
        runPlatformMigrations: false,
    });
    return bootPlugins(stack.plugins, dir);
}

async function teardown(booted: Booted | undefined): Promise<void> {
    if (!booted) return;
    try { await booted.kernel.shutdown(); } catch { /* noop */ }
    rmSync(booted.dir, { recursive: true, force: true });
}

describe('#22989 — the config door registers the stack-declared api items where the matcher reads', () => {
    const config = defineStack(authoredStack() as any);
    let configDoor: Booted | undefined;
    let artifactDoor: Booted | undefined;

    beforeAll(async () => {
        configDoor = await bootConfigDoor('config', config);
        artifactDoor = await bootArtifactDoor('artifact', JSON.parse(JSON.stringify(config)));
    }, BOOT_TIMEOUT);

    afterAll(async () => {
        await teardown(configDoor);
        await teardown(artifactDoor);
    });

    it('a config boot matches the declared path: the endpoint step answers 401 for it, not 404', async () => {
        const match = await configDoor!.metadata.matchEndpoint({ path: FEED_PATH, method: 'GET' });
        expect(match?.endpoint?.name).toBe('probe_task_feed');
        expect(match?.endpoint?.authRequired).toBe(true);
        // CONTROLS: the matcher still answers a miss where nothing is declared.
        expect(await configDoor!.metadata.matchEndpoint({ path: FEED_PATH, method: 'POST' })).toBeUndefined();
        expect(await configDoor!.metadata.matchEndpoint({
            path: '/api/v1/apps/probe/no-such-endpoint',
            method: 'GET',
        })).toBeUndefined();
    });

    it('CONTROL: the artifact boot of the same stack matches the same path', async () => {
        const match = await artifactDoor!.metadata.matchEndpoint({ path: FEED_PATH, method: 'GET' });
        expect(match?.endpoint?.name).toBe('probe_task_feed');
    });

    it('the config door\'s item is the artifact door\'s item: the same document, ADR-0010 stamp included', async () => {
        const fromConfig = await configDoor!.metadata.get('api', 'probe_task_feed');
        const fromArtifact = await artifactDoor!.metadata.get('api', 'probe_task_feed');
        expect(fromConfig).toMatchObject(STAMPS);
        expect(fromConfig).toEqual(fromArtifact);
    });
});

describe('#22989 — CONTROL: an artifact boot registers each api item exactly once', () => {
    it('the door registers it, and AppPlugin (declared `artifact-door`) does not', async () => {
        const register = vi.spyOn(MetadataManager.prototype, 'register');
        const registerInMemory = vi.spyOn(MetadataManager.prototype, 'registerInMemory');
        let booted: Booted | undefined;
        try {
            booted = await bootArtifactDoor('once', JSON.parse(JSON.stringify(defineStack(authoredStack() as any))));
            const apiWrites = (calls: unknown[][]) => calls.filter(([type]) => type === 'api').map(([, name]) => name);
            expect(apiWrites(register.mock.calls)).toEqual(['probe_task_feed']);
            expect(apiWrites(registerInMemory.mock.calls)).toEqual([]);
            expect((await booted.metadata.matchEndpoint({ path: FEED_PATH, method: 'GET' }))?.endpoint?.name)
                .toBe('probe_task_feed');
        } finally {
            register.mockRestore();
            registerInMemory.mockRestore();
            await teardown(booted);
        }
    }, BOOT_TIMEOUT);
});

describe('#22989 — the registered item is taken from the boot\'s one converted copy', () => {
    type Register = (type: string, name: string, data: unknown) => void;

    /**
     * The capturing context the #22994 unit legs use
     * (app-plugin-converted-collections.test.ts): unknown services answer
     * `undefined`, because every other read `init()` / `start()` makes is an
     * optional one they degrade past.
     */
    function fakeContext(manifestRegister: (payload: any) => void, registerInMemory: Register): PluginContext {
        const services: Record<string, unknown> = {
            manifest: { register: manifestRegister },
            metadata: { registerInMemory },
            objectql: {},
        };
        return {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => services[name]),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    }

    it('it is a stamped copy of the item `init()` handed the manifest service', async () => {
        let payload: any;
        const registerInMemory = vi.fn<Register>();
        const ctx = fakeContext((p) => { payload = p; }, registerInMemory);
        const plugin = new AppPlugin(authoredStack());
        await plugin.init!(ctx);
        await plugin.start!(ctx);

        const calls = registerInMemory.mock.calls.filter(([type]) => type === 'api');
        expect(calls.map(([, name]) => name)).toEqual(['probe_task_feed']);
        const [, , registered] = calls[0]!;
        const handedOver = payload.apis[0];
        // The one conversion's item, copied: never the same object, and the
        // manifest service's copy carries no stamp.
        expect(registered).not.toBe(handedOver);
        expect(handedOver).not.toHaveProperty('_packageId');
        expect(registered).toEqual({ ...handedOver, ...STAMPS });
    });

    it('`securityMetadataRegistrar: \'artifact-door\'` registers none: the door is that boot\'s registrar', async () => {
        const registerInMemory = vi.fn<Register>();
        const ctx = fakeContext(() => undefined, registerInMemory);
        const plugin = new AppPlugin(authoredStack(), undefined, { securityMetadataRegistrar: 'artifact-door' });
        await plugin.init!(ctx);
        await plugin.start!(ctx);
        expect(registerInMemory.mock.calls.filter(([type]) => type === 'api')).toEqual([]);
    });
});
