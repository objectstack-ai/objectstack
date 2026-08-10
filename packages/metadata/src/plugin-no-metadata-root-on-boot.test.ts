// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7000 — booting `MetadataPlugin` on a project that has never been started
 * must not bring `.objectstack/metadata/` into existence.
 *
 * This is the command-facing half of the same pin. `os migrate plan` is a
 * declared dry run: #3917 made its boot stop writing DDL and seed rows, and
 * #6743 / PR #6997 stopped the sqlite driver from creating
 * `.objectstack/data/`. What was left was this plugin — it attaches a
 * `FileSystemRepository` at `<rootDir>/.objectstack/metadata` during `start()`,
 * and the repository's `start()` used to `mkdir` its root unconditionally, so
 * the dry run left behind:
 *
 *     .objectstack/metadata/.objectstack/.log
 *
 * The CLI command is only the trigger — it performs no `mkdir` of its own —
 * so the pin sits at the attach seam, where the fix does. Everything that
 * boots this plugin without writing metadata is covered by the same change,
 * not just `migrate plan`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataPlugin } from './plugin';

vi.mock('@objectstack/core', async (orig) => {
    const real = (await orig()) as any;
    return {
        ...real,
        createLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    };
});

function createMockPluginContext() {
    return {
        registerService: vi.fn(),
        replaceService: vi.fn(),
        getService: vi.fn().mockReturnValue(null),
        getServices: vi.fn().mockReturnValue(new Map()),
        hook: vi.fn(),
        trigger: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        getKernel: vi.fn(),
    } as any;
}

describe('MetadataPlugin boot leaves no .objectstack/metadata behind (#7000)', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'os-meta7000-'));
    });

    afterEach(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('a read-only boot creates nothing under the project directory', async () => {
        expect(existsSync(join(dir, '.objectstack'))).toBe(false);

        const plugin = new MetadataPlugin({
            rootDir: dir,
            watch: false,
            config: { bootstrap: 'lazy' },
        });
        const ctx = createMockPluginContext();
        await plugin.init(ctx);
        await plugin.start(ctx);

        try {
            // Control: the attach really happened. Without this the pin would
            // pass for the uninteresting reason that no repository was ever
            // created — the boot log line `[MetadataPlugin] FileSystemRepository
            // attached` names exactly this object.
            expect((plugin as any).repository).toBeDefined();

            expect(existsSync(join(dir, '.objectstack'))).toBe(false);
            expect(existsSync(join(dir, '.objectstack', 'metadata'))).toBe(false);
            expect(readdirSync(dir)).toEqual([]);
        } finally {
            await plugin.stop(ctx);
        }

        // Shutting the plugin down is not a write either.
        expect(readdirSync(dir)).toEqual([]);
    });

    it('the same boot with the watcher enabled also creates nothing', async () => {
        const plugin = new MetadataPlugin({
            rootDir: dir,
            watch: true,
            config: { bootstrap: 'lazy' },
        });
        const ctx = createMockPluginContext();
        await plugin.init(ctx);
        await plugin.start(ctx);

        try {
            expect((plugin as any).repository).toBeDefined();
            expect(readdirSync(dir)).toEqual([]);
        } finally {
            await plugin.stop(ctx);
        }
    }, 20_000);

    it('the attached repository is still usable — a write materializes the root', async () => {
        // The other half of the control: absence must come from "attach does
        // not write", not from a repository that cannot write at all.
        const plugin = new MetadataPlugin({
            rootDir: dir,
            watch: false,
            config: { bootstrap: 'lazy' },
        });
        const ctx = createMockPluginContext();
        await plugin.init(ctx);
        await plugin.start(ctx);

        const repo = (plugin as any).repository as {
            put(ref: unknown, spec: unknown, opts: unknown): Promise<{ version: string }>;
        };
        expect(repo).toBeDefined();

        try {
            await repo.put(
                { org: 'system', type: 'view', name: 'case_grid' },
                { label: 'Cases' },
                { parentVersion: null, actor: 'tester' },
            );
            expect(existsSync(join(dir, '.objectstack', 'metadata', 'view', 'case_grid.json'))).toBe(true);
            expect(existsSync(join(dir, '.objectstack', 'metadata', '.objectstack', '.log', 'main.jsonl'))).toBe(true);
        } finally {
            await plugin.stop(ctx);
        }
    });
});
