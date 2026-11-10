// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, epic child of #31527] A composed artifact carries what two
 * installs carry: two packages of two namespaces, each declaring the
 * object-less action `qa_send_note`, composed with `manifest: 'preserve'`,
 * boot, and each package's action runs under its own package.
 *
 * ## What is pinned
 *
 * On a kernel booted from the compiled artifact the way `createStandaloneStack`
 * composes it (the artifact door, `MetadataPlugin`'s `artifactSource`, and an
 * `AppPlugin` over the same bundle), in both kernel shapes:
 *   - `POST /actions/alpha/global/qa_send_note` runs alpha's body, and
 *     `/actions/beta/global/qa_send_note` runs beta's;
 *   - the bare `POST /actions/global/qa_send_note` is refused `409
 *     RESOURCE_CONFLICT` naming both packages, and nothing runs;
 *   - CONTROL: an object-less action one package holds still runs on the bare
 *     door;
 *   - that action runs on its own package's address too, though its package is
 *     not the artifact's own id (alpha; the artifact takes beta's, the last
 *     input's manifest).
 *   - NARROWING: the artifact's own id (beta's address, `packageId:
 *     app:<beta>`) no longer reaches alpha's action; it did when every action
 *     sat under the artifact's id.
 *
 * ## The boot defect this also holds
 *
 * The binder (`bindAppArtifactHandlers`) read a multi-package artifact's
 * actions through `resolveArtifactCollections`, which keys an item by its
 * name, so the second package's same-named action was dropped, and every
 * action it bound went under the ARTIFACT's owner (`app:<artifact id>`), not
 * the package that declares it. A package-qualified call then reached no
 * handler of its own package. Each package body's actions are now bound under
 * that package (`app:<package id>`).
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';
import { AppPlugin } from '../app-plugin.js';
import { loadArtifactBundle } from '../load-artifact-bundle.js';

const CALLER = { userId: 'u_compose', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

const ALPHA = 'com.qa.compose.alpha';
const BETA = 'com.qa.compose.beta';
const SHARED = 'qa_send_note';
const SOLO = 'qa_solo_note';

const script = (from: string) => ({ language: 'js', source: `return { from: '${from}' };`, capabilities: [] });

/** One package of namespace `ns`: an object, the shared object-less action, and (alpha) a solo one. */
const packageStack = (ns: 'alpha' | 'beta') => defineStack({
    manifest: { id: `com.qa.compose.${ns}`, namespace: ns, name: `qa_compose_${ns}`, version: '1.0.0', type: ns === 'alpha' ? 'app' : 'module' },
    objects: [{ name: `${ns}_item`, label: `${ns} item`, sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
    actions: [
        { name: SHARED, label: `${ns} ${SHARED}`, type: 'script', body: script(ns) },
        ...(ns === 'alpha' ? [{ name: SOLO, label: `alpha ${SOLO}`, type: 'script', body: script('alpha-solo') }] : []),
    ],
} as never);

interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }

async function bootArtifact(environmentId: string | undefined, artifactBody: unknown): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-composed-object-less-pair-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    const artifact = join(root, 'objectstack.json');
    writeFileSync(artifact, JSON.stringify(artifactBody));
    await kernel.use(new MetadataPlugin({
        watch: false, artifactWatch: false, ...(environmentId ? { environmentId } : {}),
        artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
    } as any));
    await kernel.use(new ObjectQLPlugin({ ql: engine, ...(environmentId ? { environmentId, hydrateMetadataFromDb: true } : {}) }));
    const bundle = await loadArtifactBundle(artifact, { tag: '[composed pair rig]', unwrapEnvelope: true });
    await kernel.use(new AppPlugin(bundle, undefined, { skipSeedData: true, securityMetadataRegistrar: 'artifact-door' }));
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine, root };
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
const messageOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.message : body?.error ?? body?.message);

async function post(kernel: ObjectKernel, path: string) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    const raw = new Request(`http://localhost/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    try {
        const out: any = await dispatcher.dispatch('POST', path, {}, {}, { request: raw } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status, code: codeOf(answer), message: String(messageOf(answer) ?? ''), text: JSON.stringify(answer ?? null) };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code, message: String((e as Error)?.message ?? ''), text: '' };
    }
}

const SHAPES = [
    { shape: 'environmentId env_local (createStandaloneStack)', environmentId: 'env_local' },
    { shape: 'no environmentId', environmentId: undefined },
] as const;

describe('[ADR-0150 D4] the composed artifact of two namespaces\' same-named object-less action', () => {
    const artifact = composeStacks([packageStack('alpha'), packageStack('beta')], { manifest: 'preserve' }) as any;

    it('composes under `manifest: \'preserve\'`, each body under its own package, with no flattened copy', () => {
        const bodies = (artifact.packages as Array<{ manifest: any }>).map((entry) => entry.manifest);
        expect(bodies.map((body) => body.id)).toEqual([ALPHA, BETA]);
        for (const body of bodies) {
            expect(body.actions.filter((a: any) => a.name === SHARED).map((a: any) => a.label)).toEqual([`${body.namespace} ${SHARED}`]);
        }
        expect(artifact.actions, 'option B: each definition once, under its package').toBeUndefined();
    });

    describe.each(SHAPES)('booted on a kernel with $shape', ({ environmentId }) => {
        let booted: Booted | undefined;

        beforeAll(async () => {
            booted = await bootArtifact(environmentId, artifact);
        }, 120_000);

        afterAll(async () => {
            if (booted?.kernel.getState() === 'running') await booted.kernel.shutdown();
            if (booted) rmSync(booted.root, { recursive: true, force: true });
        });

        it('each namespace\'s address runs its own package\'s body', async () => {
            for (const ns of ['alpha', 'beta'] as const) {
                const answer = await post(booted!.kernel, `/actions/${ns}/global/${SHARED}`);
                expect(answer.status, answer.message).toBe(200);
                expect(answer.text).toContain(`"from":"${ns}"`);
            }
        });

        it('the bare call is refused 409 naming both packages, and nothing runs', async () => {
            const answer = await post(booted!.kernel, `/actions/global/${SHARED}`);
            expect([answer.status, answer.code], answer.message).toEqual([409, 'RESOURCE_CONFLICT']);
            for (const holder of [ALPHA, BETA]) expect(answer.message).toContain(holder);
            expect(answer.text).not.toContain('"from"');
        });

        it('CONTROL — an object-less action one package holds runs on the bare door', async () => {
            const answer = await post(booted!.kernel, `/actions/global/${SOLO}`);
            expect(answer.status, answer.message).toBe(200);
            expect(answer.text).toContain('"from":"alpha-solo"');
        });

        it('a package other than the artifact\'s own reaches its one-holder action at its own address (base: 404, bound under the artifact\'s id)', async () => {
            const answer = await post(booted!.kernel, `/actions/alpha/global/${SOLO}`);
            expect(answer.status, answer.message).toBe(200);
            expect(answer.text).toContain('"from":"alpha-solo"');
        });

        it('NARROWING — the artifact\'s own id no longer reaches another package\'s action (base: 200, every action bound under the artifact\'s id)', async () => {
            // The artifact takes beta's manifest (the last input's), so beta's
            // address and `packageId: app:<beta>` qualified by the artifact's
            // own id; alpha's one-holder action is alpha's alone now.
            const answer = await post(booted!.kernel, `/actions/beta/global/${SOLO}`);
            expect(answer.status, answer.message).toBe(404);
            expect(answer.text).not.toContain('"from"');
            const direct = await booted!.engine
                .executeAction('global', SOLO, { params: {} }, { packageId: `app:${BETA}` })
                .then((value: unknown) => ({ value }), (error: Error) => ({ error: error.message }));
            expect(direct).toHaveProperty('error');
            expect(JSON.stringify(direct)).not.toContain('alpha-solo');
        });
    });
});
