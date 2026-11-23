// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #36647: an artifact boot runs none of the app's code plugins, and now says
 * so, naming each one, once.
 *
 * `os build` writes a stack's `plugins` into the artifact as plain descriptors
 * (`{ name, version, dependencies, options }`); the runtime module beside it
 * exports `functions` only. So `createStandaloneStack` over that artifact (the
 * artifact door every artifact boot goes through: `OS_ARTIFACT_URL`, the
 * composed hosted boot, `os start` on a built app) mounts none of them, which
 * is correct under the envelope-key ruling (an artifact carries metadata, a
 * host assembles plugins). Before this it said nothing: the knowledge service,
 * the vector adapter and the app's own indexer were simply absent.
 *
 * The boots below are real: `createStandaloneStack`'s plugins over an artifact
 * file on disk, on a fresh kernel. The warning is identified by its structured
 * fields (the app id and the list of names), never by its prose.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';
import { findUnmountedDeclaredPlugins } from './artifact-declared-plugins.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the factory and the kernel boot below import them lazily, inside
// a clocked hook (`scripts/check-test-source-alias.mjs`, the clocked-window rule).
import '@objectstack/objectql';
import '@objectstack/service-datasource';
import '@objectstack/metadata';

const APP_ID = 'com.test.issue-36647';
const VECTOR = 'com.test.issue-36647.vector';
const INDEXER = 'com.test.issue-36647.indexer';
const BOOT_TIMEOUT = 120_000;

/** A descriptor exactly as `os build` serializes a plugin instance into the artifact. */
const descriptor = (name: string) => ({ name, version: '1.0.0', dependencies: [], options: {} });

const artifact = (plugins: unknown[] | undefined) => ({
    manifest: { id: APP_ID, name: 'Plugin Drop Probe', version: '1.0.0', type: 'app', namespace: 'probep' },
    objects: [{ name: 'probep_clause', label: 'Clause', fields: { title: { type: 'text', label: 'Title' } } }],
    ...(plugins ? { plugins } : {}),
});

/** A host-mounted plugin under `name`: what a host config that assembles the app's plugins registers. */
const hostPlugin = (name: string) => ({ name, version: '1.0.0', init: async () => {}, start: async () => {} });

interface Booted {
    /** Every `warn` the kernel logger took about this app's listed plugins. */
    warnings: Array<{ message: string; meta: any }>;
    /** Whether the kernel's table holds each probe name. */
    registered: Record<string, boolean>;
}

async function bootArtifact(
    tag: string,
    plugins: unknown[] | undefined,
    extra: unknown[] = [],
): Promise<Booted> {
    const dir = mkdtempSync(join(tmpdir(), `os-36647-${tag}-`));
    let kernel: any;
    try {
        const artifactPath = join(dir, 'objectstack.json');
        writeFileSync(artifactPath, JSON.stringify(artifact(plugins)), 'utf-8');
        const standalone = await createStandaloneStack({
            artifactPath,
            projectRoot: dir,
            databaseUrl: ':memory:',
            skipSeedData: true,
            runPlatformMigrations: false,
        });
        // CONTROL on the composition: the artifact loaded, so the door pushed its AppPlugin.
        expect(standalone.plugins.some((p: any) => p instanceof AppPlugin)).toBe(true);
        kernel = new Runtime({ cluster: false }).getKernel();
        const warn = vi.spyOn(kernel.logger, 'warn');
        for (const p of [...extra, ...standalone.plugins]) await kernel.use(p as any);
        await kernel.bootstrap();
        const warnings = warn.mock.calls
            .map(([message, meta]) => ({ message: String(message), meta: meta as any }))
            .filter(({ meta }) => meta?.appId === APP_ID && Array.isArray(meta?.plugins));
        const registered = Object.fromEntries([VECTOR, INDEXER].map((n) => [n, kernel.hasPlugin(n)]));
        return { warnings, registered };
    } finally {
        try { await kernel?.shutdown(); } catch { /* noop */ }
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('#36647 — an artifact boot names every listed plugin it does not run', () => {
    it('two descriptors, neither mounted: exactly one warning naming both', async () => {
        const booted = await bootArtifact('none', [descriptor(VECTOR), descriptor(INDEXER)]);
        // CONTROL: the drop is real — neither plugin is in the kernel's table.
        expect(booted.registered).toEqual({ [VECTOR]: false, [INDEXER]: false });
        expect(booted.warnings).toHaveLength(1);
        expect(booted.warnings[0]!.meta).toEqual({ appId: APP_ID, plugins: [VECTOR, INDEXER] });
        // The subject names are in the line an operator reads, beside the remedy.
        expect(booted.warnings[0]!.message).toContain(VECTOR);
        expect(booted.warnings[0]!.message).toContain(INDEXER);
        expect(booted.warnings[0]!.message).toContain('os plugin build');
    }, BOOT_TIMEOUT);

    it('CONTROL: a host that mounts one of them is told only about the other', async () => {
        const booted = await bootArtifact('host-one', [descriptor(VECTOR), descriptor(INDEXER)], [hostPlugin(VECTOR)]);
        expect(booted.registered).toEqual({ [VECTOR]: true, [INDEXER]: false });
        expect(booted.warnings).toHaveLength(1);
        expect(booted.warnings[0]!.meta).toEqual({ appId: APP_ID, plugins: [INDEXER] });
    }, BOOT_TIMEOUT);

    it('CONTROL: a host that mounts both says nothing', async () => {
        const booted = await bootArtifact(
            'host-both',
            [descriptor(VECTOR), descriptor(INDEXER)],
            [hostPlugin(VECTOR), hostPlugin(INDEXER)],
        );
        expect(booted.registered).toEqual({ [VECTOR]: true, [INDEXER]: true });
        expect(booted.warnings).toEqual([]);
    }, BOOT_TIMEOUT);

    it('CONTROL: an artifact that lists no plugins says nothing', async () => {
        const booted = await bootArtifact('no-plugins', undefined);
        expect(booted.warnings).toEqual([]);
    }, BOOT_TIMEOUT);

    it('CONTROL: a config boot (no artifactBoot) never judges its plugins — the host materializes them', async () => {
        const kernel: any = new Runtime({ cluster: false }).getKernel();
        try {
            const warn = vi.spyOn(kernel.logger, 'warn');
            await kernel.use(new AppPlugin(artifact([descriptor(VECTOR)])) as any);
            await kernel.bootstrap();
            const warnings = warn.mock.calls.filter(([, meta]) => (meta as any)?.appId === APP_ID && Array.isArray((meta as any)?.plugins));
            expect(warnings).toEqual([]);
        } finally {
            try { await kernel.shutdown(); } catch { /* noop */ }
        }
    }, BOOT_TIMEOUT);
});

describe('findUnmountedDeclaredPlugins — which entries can be judged by name', () => {
    const none = () => false;

    it('names each unregistered descriptor once, in listed order', () => {
        expect(findUnmountedDeclaredPlugins([descriptor('b'), descriptor('a'), descriptor('b')], none)).toEqual(['b', 'a']);
    });

    it('a bundle entry (no init) counts as mounted when the host wrapped it into its AppPlugin', () => {
        const bundle = { name: 'crm', manifest: { id: 'com.example.crm' }, objects: [] };
        expect(findUnmountedDeclaredPlugins([bundle], (n) => n === 'plugin.app.com.example.crm')).toEqual([]);
        expect(findUnmountedDeclaredPlugins([bundle], none)).toEqual(['crm']);
    });

    it('a live plugin instance counts only under its own name', () => {
        const live = hostPlugin('com.example.live');
        expect(findUnmountedDeclaredPlugins([live], (n) => n === 'plugin.app.com.example.live')).toEqual(['com.example.live']);
    });

    it('a package specifier string, an unnamed entry and a non-array are never named', () => {
        expect(findUnmountedDeclaredPlugins(['@acme/plugin-x', {}, null, 7, { name: '' }], none)).toEqual([]);
        expect(findUnmountedDeclaredPlugins(undefined, none)).toEqual([]);
        expect(findUnmountedDeclaredPlugins({ name: 'x' }, none)).toEqual([]);
    });
});
