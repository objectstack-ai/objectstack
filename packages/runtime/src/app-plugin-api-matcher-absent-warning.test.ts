// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22989 (the maintainer's option B): a composition whose `metadata` slot has
 * no endpoint matcher says so ONCE when the stack declares `apis`, with the
 * count and the remedy, instead of leaving every declared path to a bare
 * `404 ENDPOINT_NOT_FOUND` (AGENTS.md, "Absence must be loud").
 *
 * The matcher is `matchEndpoint`, which in-tree only `@objectstack/metadata`'s
 * `MetadataManager` carries. A composition without `MetadataPlugin` boots on
 * the kernel's in-memory core fallback (`createMemoryMetadata`): it lists the
 * registered `api` items and serves none of them. `@objectstack/verify`'s lean
 * `bootStack` is that composition; so was every host-config `os serve` before
 * the CLI composed a `MetadataPlugin` there (option A, `serve.ts`).
 *
 * The compositions below are real kernel boots: `createStandaloneStack`'s
 * plugins over an absent artifact, with and without its `MetadataPlugin`,
 * plus the CLI's `new AppPlugin(config)` wrap. The warning is identified by
 * its named subjects (the app id and the remedy plugin) and its structured
 * fields, never by its prose.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineStack } from '@objectstack/spec';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the factory and the kernel boot below import them lazily, inside
// a clocked hook (`scripts/check-test-source-alias.mjs`, the clocked-window rule).
import '@objectstack/objectql';
import '@objectstack/service-datasource';
import '@objectstack/metadata';

const APP_ID = 'com.test.issue-22989-matcher';
const FEED_PATH = '/api/v1/apps/probem/tasks';
const BOOT_TIMEOUT = 120_000;

const stack = (withApis: boolean) => defineStack({
    manifest: { id: APP_ID, name: 'Matcher Probe', version: '1.0.0', type: 'app', namespace: 'probem' },
    objects: [{ name: 'probem_task', label: 'Probe Task', fields: { title: { type: 'text', label: 'Title' } } }],
    ...(withApis
        ? {
            apis: [{
                name: 'probem_task_feed',
                path: FEED_PATH,
                method: 'GET',
                summary: 'Task feed',
                type: 'object_operation',
                objectParams: { object: 'probem_task', operation: 'find' },
                authRequired: true,
            }],
        }
        : {}),
} as any);

interface Booted {
    /** Whether the booted `metadata` slot carries `matchEndpoint`. */
    hasMatcher: boolean;
    /** The matcher's answer for the declared path, read while the kernel runs. */
    feedMatch: string | undefined;
    /** Every `warn` the kernel logger took that names this app AND the remedy plugin. */
    matcherWarnings: Array<{ message: string; meta: any }>;
}

async function boot(tag: string, opts: { metadataPlugin: boolean; withApis: boolean }): Promise<Booted> {
    const dir = mkdtempSync(join(tmpdir(), `os-22989-b-${tag}-`));
    let kernel: any;
    try {
        const standalone = await createStandaloneStack({
            artifactPath: join(dir, 'dist', 'objectstack.json'),
            projectRoot: dir,
            databaseUrl: ':memory:',
            skipSeedData: true,
            runPlatformMigrations: false,
        });
        const plugins = opts.metadataPlugin
            ? standalone.plugins
            : standalone.plugins.filter((p: any) => p?.name !== 'com.objectstack.metadata');
        // CONTROL on the composition itself: the filter removed exactly the door.
        expect(standalone.plugins.length - plugins.length).toBe(opts.metadataPlugin ? 0 : 1);
        kernel = new Runtime({ cluster: false }).getKernel();
        // The context every plugin is handed carries the kernel's own logger
        // instance, so a spy on that instance sees AppPlugin's warnings.
        const warn = vi.spyOn(kernel.logger, 'warn');
        for (const p of [...plugins, new AppPlugin(stack(opts.withApis))]) await kernel.use(p);
        await kernel.bootstrap();
        const matcherWarnings = warn.mock.calls
            .map(([message, meta]) => ({ message: String(message), meta }))
            .filter(({ message }) => message.includes(APP_ID) && message.includes('MetadataPlugin'));
        const metadata = kernel.getService('metadata');
        const hasMatcher = typeof metadata?.matchEndpoint === 'function';
        const feedMatch = hasMatcher
            ? (await metadata.matchEndpoint({ path: FEED_PATH, method: 'GET' }))?.endpoint?.name
            : undefined;
        return { hasMatcher, feedMatch, matcherWarnings };
    } finally {
        try { await kernel?.shutdown(); } catch { /* noop */ }
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('#22989 B — a composition with no endpoint matcher warns once when the stack declares apis', () => {
    it('the in-memory fallback composition logs exactly one warning, naming the count', async () => {
        const booted = await boot('fallback', { metadataPlugin: false, withApis: true });
        // CONTROL: this boot's slot really is matcher-less.
        expect(booted.hasMatcher).toBe(false);
        expect(booted.matcherWarnings).toHaveLength(1);
        expect(booted.matcherWarnings[0]!.meta).toEqual({ appId: APP_ID, count: 1 });
    }, BOOT_TIMEOUT);

    it('CONTROL: with a MetadataManager, no warning — and the declared path matches', async () => {
        const booted = await boot('manager', { metadataPlugin: true, withApis: true });
        expect(booted.hasMatcher).toBe(true);
        expect(booted.feedMatch).toBe('probem_task_feed');
        expect(booted.matcherWarnings).toEqual([]);
    }, BOOT_TIMEOUT);

    it('CONTROL: with no apis declared, the matcher-less composition says nothing', async () => {
        const booted = await boot('no-apis', { metadataPlugin: false, withApis: false });
        expect(booted.hasMatcher).toBe(false);
        expect(booted.matcherWarnings).toEqual([]);
    }, BOOT_TIMEOUT);
});
