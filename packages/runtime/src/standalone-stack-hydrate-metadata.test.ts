// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20071] A standalone boot reads its OWN `sys_metadata` back into the
// registry, whatever environment id it stamps.
//
// `createStandaloneStack` stamps `environmentId: 'env_local'` (or whatever
// `OS_ENVIRONMENT_ID` / `cfg.environmentId` names), and `ObjectQLPlugin.start()`
// used to read ANY environment id as "a per-project kernel whose metadata comes
// from an artifact or a control-plane proxy" and skip Phase-2 hydration. So an
// object created and published at runtime kept its `sys_metadata` row across a
// restart and was never registered again: the data API answered
// `404 OBJECT_NOT_FOUND` for it (measured end to end by
// `packages/cli/test/package-restart-acceptance.integration.test.ts`).
//
// Two halves, pinned where each is observable:
//
//   1. The DECLARATION, read off the plugin the stack hands the kernel — the
//      same seam `standalone-stack-default-environment-id.test.ts` reads the
//      stamped id from. It is asserted under all three ways an id gets stamped,
//      because the defect was precisely that the stamp decided hydration.
//   2. The EFFECT, on a real kernel booted twice over one SQLite file: an
//      env-wide `object` row AND an env-wide `app` row written through the
//      protocol on boot 1 are in the second boot's registry, and a record
//      inserted on boot 1 is read back through the engine on boot 2. The `app`
//      row is there because the card measured one object only: hydration is
//      type-blind for env-wide rows (`loadMetaFromDb` registers objects through
//      `registerObject` and every other type through `registerItem`), and this
//      makes that reach a measurement instead of a reading of the code.
//
// ⛔ Org-scoped rows are NOT asserted here, deliberately: `loadMetaFromDb`
// hydrates `organization_id IS NULL` rows only (ADR-0005 — a per-org overlay
// is served on demand, never grafted into the registry every org shares), so an
// org row absent after a restart is the design, not this defect.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body
// (the factory and the kernel boot both import lazily) -- vitest clocks those,
// while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const OBJECTQL_PLUGIN = 'com.objectstack.engine.objectql';
const BOOT_TIMEOUT = 120_000;

const OBJECT = 'hydr_widget';
const APP = 'hydr_console';

/**
 * The hydration flag as `ObjectQLPlugin` actually holds it. TypeScript-private,
 * read on purpose: it is the one value `start()` gates Phase 2 on, so a pin that
 * re-declared the literal would stay green through a change that stopped
 * passing it.
 */
function hydrationFlag(plugins: readonly unknown[]): { environmentId: unknown; hydrateMetadataFromDb: unknown } {
    const objectql = plugins.find((p: any) => p?.name === OBJECTQL_PLUGIN) as any;
    expect(objectql, `stack must carry ${OBJECTQL_PLUGIN}`).toBeDefined();
    return { environmentId: objectql.environmentId, hydrateMetadataFromDb: objectql.hydrateMetadataFromDb };
}

async function boot(plugins: readonly unknown[]) {
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    for (const p of plugins) await kernel.use(p as any);
    await kernel.bootstrap();
    return kernel;
}

describe('[#20071] createStandaloneStack declares sys_metadata hydration instead of deducing it from the environment id', () => {
    const dirs: string[] = [];
    const kernels: any[] = [];
    let savedEnvId: string | undefined;
    let savedHome: string | undefined;

    function tempDir(tag: string): string {
        const dir = mkdtempSync(join(tmpdir(), `os-20071-${tag}-`));
        dirs.push(dir);
        return dir;
    }

    beforeEach(() => {
        savedEnvId = process.env.OS_ENVIRONMENT_ID;
        savedHome = process.env.OS_HOME;
        delete process.env.OS_ENVIRONMENT_ID;
        process.env.OS_HOME = tempDir('home');
    });

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (savedEnvId === undefined) delete process.env.OS_ENVIRONMENT_ID;
        else process.env.OS_ENVIRONMENT_ID = savedEnvId;
        if (savedHome === undefined) delete process.env.OS_HOME;
        else process.env.OS_HOME = savedHome;
        for (const d of dirs.splice(0)) {
            try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
        }
    });

    it('hands ObjectQLPlugin `hydrateMetadataFromDb: true` under every way an environment id is stamped', async () => {
        const byDefault = await createStandaloneStack({ databaseUrl: 'memory://issue-20071-default' });
        expect(hydrationFlag(byDefault.plugins)).toEqual({ environmentId: 'env_local', hydrateMetadataFromDb: true });

        process.env.OS_ENVIRONMENT_ID = 'env_from_the_environment';
        const byEnv = await createStandaloneStack({ databaseUrl: 'memory://issue-20071-env' });
        expect(hydrationFlag(byEnv.plugins)).toEqual({
            environmentId: 'env_from_the_environment',
            hydrateMetadataFromDb: true,
        });

        const byConfig = await createStandaloneStack({
            environmentId: 'env_from_the_config',
            databaseUrl: 'memory://issue-20071-cfg',
        });
        expect(hydrationFlag(byConfig.plugins)).toEqual({
            environmentId: 'env_from_the_config',
            hydrateMetadataFromDb: true,
        });

        // The declaration is the caller's to make: a boot that says `false`
        // gets `false`, and nothing about its environment id overrides that.
        const declaredOff = await createStandaloneStack({
            databaseUrl: 'memory://issue-20071-off',
            hydrateMetadataFromDb: false,
        });
        expect(hydrationFlag(declaredOff.plugins)).toEqual({
            environmentId: 'env_from_the_environment',
            hydrateMetadataFromDb: false,
        });
    }, BOOT_TIMEOUT);

    it('an env-wide object and an env-wide app written at runtime are registered again after a restart on the same database file', async () => {
        const dir = tempDir('restart');
        const databaseUrl = `file:${join(dir, 'hydrate.db')}`;
        const stackConfig = { projectRoot: dir, databaseUrl, skipSeedData: true, runPlatformMigrations: false } as const;

        // ── boot 1: author both rows at runtime, and one record ────────────────
        const first = await boot((await createStandaloneStack(stackConfig)).plugins);
        kernels.push(first);
        const protocol: any = first.getService('protocol');
        await protocol.saveMetaItem({
            type: 'object',
            name: OBJECT,
            item: {
                name: OBJECT,
                label: 'Widget',
                sharingModel: 'private',
                fields: { title: { type: 'text', label: 'Title' } },
            },
        });
        await protocol.saveMetaItem({ type: 'app', name: APP, item: { name: APP, label: 'Hydration Console' } });
        const engine1: any = first.getService('objectql');
        // Harness health: both rows are persisted env-wide and active — exactly
        // the population `loadMetaFromDb` selects — so their absence from the
        // next boot's registry can only be the boot's doing.
        for (const [type, name] of [['object', OBJECT], ['app', APP]] as const) {
            const stored: Array<{ state?: unknown; organization_id?: unknown }> =
                await engine1.find('sys_metadata', { where: { type, name } });
            expect(
                stored.map((r) => ({ state: r.state, organization_id: r.organization_id ?? null })),
                `boot 1 persists ${type}/${name} as one env-wide active row`,
            ).toEqual([{ state: 'active', organization_id: null }]);
        }
        // The object is also serving on boot 1 (its write-through is not gated on
        // the environment id). The app is NOT in this boot's registry: the
        // protocol's write-through for every non-object type returns early on a
        // kernel with an environment id, so on this composition boot hydration
        // is the only path that puts it there — which is what makes it a sharp
        // second leg below.
        expect(engine1.registry.getObject(OBJECT)?.name, 'boot 1 registers the object it just saved').toBe(OBJECT);
        await engine1.insert(OBJECT, { title: 'survives the restart' });
        await first.shutdown();
        kernels.splice(kernels.indexOf(first), 1);

        // ── boot 2: same file, nothing authored — only hydration can bring them back
        const second = await boot((await createStandaloneStack(stackConfig)).plugins);
        kernels.push(second);
        const engine2: any = second.getService('objectql');
        expect(engine2.registry.getObject(OBJECT)?.name, `${OBJECT} is registered after the restart`).toBe(OBJECT);
        expect(engine2.registry.getItem('app', APP)?.name, `app ${APP} is registered after the restart`).toBe(APP);
        const rows: Array<{ title?: unknown }> = await engine2.find(OBJECT, {});
        expect(rows.map((r) => r.title)).toEqual(['survives the restart']);
    }, BOOT_TIMEOUT);
});
