// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29568, ADR-0146 D2/D3/D11] The read-only refusal's remedy, FOLLOWED: a
// caller refused `422 WRITABLE_PACKAGE_REQUIRED` on a code package reads the
// route out of the message and takes it, and it works.
//
// The composition is the one `os dev` serves (`createStandaloneStack` over an
// artifact the boot registers as code), driven through the HTTP dispatcher's
// own doors: `DELETE /packages/:id` for the refusal, the ensure door the
// message names, and the metadata save door with the `?package=` the message
// names, carrying the `overrides` declaration it names. The served read of the
// item's name then answers the saved body.
//
// The control is the retired remedy: the same body saved with no package (the
// ADR-0131 D6 "save an item under its own name") is refused `403
// NOT_OVERRIDABLE` and names the pair — which is why the refusal stopped
// prescribing it. Per-door pins of the sentence itself live in
// `domains/packages-readonly-remedy-pair-route.test.ts`.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';
import { HttpDispatcher } from './http-dispatcher.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// boot reaches through a dynamic `import()` at MODULE LOAD, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 90_000;
const BASE = 'com.test.readonly-remedy';
const VERSION = '2.3.0';
const DASHBOARD = 'rrm_overview';

const artifact = {
    // `namespace`: the base's `.custom` pair is formed from it (ADR-0146 D3).
    manifest: { id: BASE, name: 'readonly_remedy', type: 'app', version: VERSION, namespace: 'rrm' },
    objects: [{ name: 'rrm_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } }],
    dashboards: [{ name: DASHBOARD, label: 'Overview (shipped)', widgets: [] }],
};

/** A `manage_metadata` holder under `single`, the caller every door below admits. */
const admin = (): any => ({
    request: {},
    environmentId: undefined,
    executionContext: {
        userId: 'u_remedy_admin',
        isSystem: false,
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
});

describe('the read-only refusal\'s remedy, followed through the real doors, works (#29568)', () => {
    const dirs: string[] = [];
    const kernels: any[] = [];
    let priorHome: string | undefined;

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (priorHome === undefined) delete process.env.OS_HOME;
        else process.env.OS_HOME = priorHome;
        for (const d of dirs.splice(0)) {
            try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
        }
    });

    async function boot() {
        const dir = mkdtempSync(join(tmpdir(), 'os-readonly-remedy-'));
        dirs.push(dir);
        const artifactPath = join(dir, 'objectstack.json');
        writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');
        // The ensure door really installs the pair; keep its writes in the temp dir.
        priorHome = process.env.OS_HOME;
        process.env.OS_HOME = dir;
        const stack = await createStandaloneStack({
            artifactPath,
            projectRoot: dir,
            databaseUrl: ':memory:',
            skipSeedData: true,
            runPlatformMigrations: false,
        });
        const runtime = new Runtime({ cluster: false });
        const kernel = runtime.getKernel();
        kernels.push(kernel);
        for (const p of stack.plugins) await kernel.use(p as any);
        await kernel.bootstrap();
        return { dispatcher: new HttpDispatcher(kernel as any), protocol: kernel.getService('protocol') as any };
    }

    it('DELETE is refused naming the pair route; ensure, then the declared save into the pair, is served', async () => {
        const { dispatcher, protocol } = await boot();

        // 1. The refusal, and the route it names, read out of the message.
        const refused: any = await dispatcher.handlePackages(`/${BASE}`, 'DELETE', {}, {}, admin());
        expect(refused.response?.status, JSON.stringify(refused.response?.body)).toBe(422);
        expect(refused.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
        const message = String(refused.response?.body?.error?.message);
        const ensureRoute = /ensure it with POST \/api\/v1\/packages\/(\S+)\/ensure-customization,/.exec(message)?.[1];
        const pair = /\(\?package=(\S+)\)/.exec(message)?.[1];
        const declared = /declaring overrides: \{ package: '([^']+)', basedOn \}/.exec(message)?.[1];
        expect({ ensureRoute, pair, declared }).toEqual({ ensureRoute: BASE, pair: `${BASE}.custom`, declared: BASE });

        const shipped = { name: DASHBOARD, label: 'Overview (shipped)', widgets: [] };
        const ours = { ...shipped, label: 'Overview (ours)' };
        const served = async () => (await protocol.getMetaItem({ type: 'dashboard', name: DASHBOARD }))?.item?.label;
        expect(await served()).toBe('Overview (shipped)');

        // Control: the retired remedy — the same item saved under its own name,
        // naming no package — is the dead end ADR-0146 D11 closed.
        const packageless: any = await dispatcher.handleMetadata(`/dashboard/${DASHBOARD}`, admin(), 'PUT', ours, {});
        expect(packageless.response?.status, JSON.stringify(packageless.response?.body)).toBe(403);
        expect(JSON.stringify(packageless.response?.body)).toContain('NOT_OVERRIDABLE');
        expect(JSON.stringify(packageless.response?.body)).toContain(`${BASE}.custom`);
        expect(await served()).toBe('Overview (shipped)');

        // 2. The ensure door the message names creates the pair.
        const ensured: any = await dispatcher.handlePackages(`/${ensureRoute}/ensure-customization`, 'POST', undefined, {}, admin());
        expect(ensured.response?.status, JSON.stringify(ensured.response?.body)).toBe(201);
        expect(ensured.response?.body?.data).toMatchObject({ basePackageId: BASE, packageId: pair, created: true });

        // 3. The save the message names: into the pair, declaring the override.
        const saved: any = await dispatcher.handleMetadata(
            `/dashboard/${DASHBOARD}`, admin(), 'PUT',
            { ...ours, overrides: { package: declared, basedOn: VERSION } },
            { package: pair },
        );
        expect(saved.response?.status, JSON.stringify(saved.response?.body)).toBe(200);

        // 4. The item's name now serves the customization; the base is untouched.
        expect(await served()).toBe('Overview (ours)');
        const base: any = await dispatcher.handlePackages(`/${BASE}`, 'GET', undefined, {}, admin());
        expect(base.response?.status).toBe(200);
    }, BOOT_TIMEOUT);
});
