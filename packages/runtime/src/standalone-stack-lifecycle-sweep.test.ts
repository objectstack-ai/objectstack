// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21391] `armLifecycleSweep: false` keeps the ADR-0057 lifecycle sweep from
// being armed at all, so a one-shot boot never sweeps by construction rather
// than because it exits before the first run is due.
//
// Two halves, pinned where each is observable:
//
//   1. The DECLARATION, read off the plugin the stack hands the kernel: the
//      `lifecycle` options `ObjectQLPlugin` holds. A serving boot (the key
//      omitted, or `true`) hands it exactly what it always did, nothing.
//   2. The EFFECT, on a real kernel over a SQLite file: after `start()`, the
//      `LifecycleService`'s timers are unset with the key `false` and set
//      without it. The timers ARE the arming, so they are read directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD: the stack and the boot import them lazily, inside a clocked `it()` body
// (`scripts/check-test-source-alias.mjs`, the clocked-window rule).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const OBJECTQL_PLUGIN = 'com.objectstack.engine.objectql';
const BOOT_TIMEOUT = 120_000;

/** The `lifecycle` options as `ObjectQLPlugin` holds them. TypeScript-private, read on purpose. */
function lifecycleOptions(plugins: readonly unknown[]): unknown {
    const objectql = plugins.find((p: any) => p?.name === OBJECTQL_PLUGIN) as any;
    expect(objectql, `stack must carry ${OBJECTQL_PLUGIN}`).toBeDefined();
    return objectql.lifecycleOptions;
}

describe('[#21391] createStandaloneStack declares whether the lifecycle sweep is armed', () => {
    const dirs: string[] = [];
    const kernels: any[] = [];
    let savedDisabled: string | undefined;

    beforeEach(() => {
        // The env switch would make every reading below `false` for a reason
        // that is not the key under test.
        savedDisabled = process.env.OS_LIFECYCLE_DISABLED;
        delete process.env.OS_LIFECYCLE_DISABLED;
    });

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (savedDisabled === undefined) delete process.env.OS_LIFECYCLE_DISABLED;
        else process.env.OS_LIFECYCLE_DISABLED = savedDisabled;
        for (const d of dirs.splice(0)) {
            try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
        }
    });

    async function armedAfterStart(armLifecycleSweep: boolean | undefined): Promise<boolean> {
        const dir = mkdtempSync(join(tmpdir(), 'os-21391-lifecycle-'));
        dirs.push(dir);
        const stack = await createStandaloneStack({
            projectRoot: dir,
            databaseUrl: `file:${join(dir, 'app.db')}`,
            skipSeedData: true,
            runPlatformMigrations: false,
            ...(armLifecycleSweep === undefined ? {} : { armLifecycleSweep }),
        });
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();
        kernels.push(kernel);
        for (const p of stack.plugins) await kernel.use(p);
        await kernel.bootstrap();
        const lifecycle = kernel.getService('lifecycle') as { initialTimer?: unknown; timer?: unknown };
        return lifecycle.initialTimer !== undefined || lifecycle.timer !== undefined;
    }

    it('hands ObjectQLPlugin `lifecycle: { enabled: false }` for `false`, and nothing otherwise', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-21391-lifecycle-decl-'));
        dirs.push(dir);
        const databaseUrl = `file:${join(dir, 'app.db')}`;
        expect(lifecycleOptions((await createStandaloneStack({ projectRoot: dir, databaseUrl, armLifecycleSweep: false })).plugins))
            .toEqual({ enabled: false });
        expect(lifecycleOptions((await createStandaloneStack({ projectRoot: dir, databaseUrl, armLifecycleSweep: true })).plugins))
            .toBeUndefined();
        expect(lifecycleOptions((await createStandaloneStack({ projectRoot: dir, databaseUrl })).plugins))
            .toBeUndefined();
    }, BOOT_TIMEOUT);

    it('a started kernel holds no sweep timer with `false`, and holds one without the key', async () => {
        expect(await armedAfterStart(false)).toBe(false);
        expect(await armedAfterStart(undefined)).toBe(true);
    }, BOOT_TIMEOUT);
});
