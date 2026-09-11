// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17432 — the route surface `projectResolution: 'required'` actually serves.
 *
 * ## What is pinned, and why a pin rather than a repair
 *
 * Under `required` the dispatcher plugin drops the UNSCOPED mounts of
 * `registerAutomationRoutes` / `registerActionRoutes` / `registerAIRoutes`, and
 * keeps `/packages*` mounted unscoped as well as scoped. That asymmetry is
 * RULED, not an oversight: the mount site records it in full
 * (`dispatcher-plugin.ts`, beside the scoped package mount), because taking a
 * mounted route surface away is a different change with a different blast
 * radius than adding a missing door — #16781's residue under ruling C' on
 * #14503 step 2.
 *
 * A recorded decision that lives only in a comment is one a future "tidy-up"
 * has to NOTICE. This file is that decision expressed as a test: moving
 * `registerPackageRoutes(prefix)` into the `required` branch turns the first
 * case below red, and the reader is sent to the comment rather than to a
 * paragraph nobody read. The isolation half — that the unscoped door reaches no
 * other environment's package data, which is what makes keeping it safe — is
 * measured in `packages-unscoped-environment-binding.test.ts`.
 *
 * ## The composition, and the discriminator
 *
 * `plugin-hono-server` + the dispatcher, scoping on, `required`. No
 * `createHonoApp`, no `@objectstack/rest`, no service plugins — so nothing may
 * supply a second door and a mount is the only way in, exactly as in
 * `dispatcher-plugin.scoped-packages-door.integration.test.ts`, whose
 * discriminator this file reuses: a credential-less request that REACHES the
 * dispatcher is answered from the anonymous-deny floor (`ANONYMOUS_DENY_STATUS`
 * / `ANONYMOUS_DENY_CODE`, imported rather than spelled), a verdict no
 * transport-level sink emits, while a path no mount claims is answered by the
 * transport's own `notFound`. Both directions are measured below rather than
 * assumed, and the dropped sibling mounts are the second direction: they are
 * the reason "404 means unmounted" is a reading here.
 *
 * ⚠️ The `/ai` family is deliberately NOT among the dropped-mount cases. Its
 * dynamic routes arrive from `AIServicePlugin` through the `ai:routes` hook,
 * which this composition never fires, so an `/ai` 404 here would be silent
 * about `projectResolution` — it would be about the absent service plugin.
 * `registerAIRoutes`' own mounts sit on the same branch as automation and
 * actions; those two carry the case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS, LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const PREFIX = '/api/v1';
const ENV_ID = 'env_alpha';
const PKG_ID = 'com.acme.crm';

let kernel: LiteKernel | undefined;
let baseUrl = '';

beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(createDispatcherPlugin({
        prefix: PREFIX,
        scoping: { enableProjectScoping: true, projectResolution: 'required' },
        enforceProjectMembership: false,
        securityHeaders: false,
    }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
}, 60_000);

afterAll(async () => {
    if (!kernel) return;
    await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
}, 60_000);

async function probe(method: string, path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, { method });
    let body: any;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
}

/** Did the DISPATCHER answer? Minted inside `dispatch()`, by nothing in the transport. */
function dispatcherAnswered(r: { status: number; body: any }): boolean {
    return r.status === ANONYMOUS_DENY_STATUS && r.body?.error?.code === ANONYMOUS_DENY_CODE;
}

/** The shape "no door answered" takes on this transport. */
function transportRefused(r: { status: number; body: any }): boolean {
    const code = r.body?.error?.code;
    return r.status === 404 && (code === undefined || code === 'ROUTE_NOT_FOUND' || code === 'ENDPOINT_NOT_FOUND');
}

const UNSCOPED = `${PREFIX}/packages`;
const SCOPED = `${PREFIX}/environments/${ENV_ID}/packages`;

/** The package routes the card names, destructive verb included. */
const PACKAGE_ROUTES: Array<[string, string]> = [
    ['GET', ''],
    ['GET', `/${PKG_ID}`],
    ['DELETE', `/${PKG_ID}`],
];

describe("#17432 — under `required`, /packages* stays mounted unscoped (ruled, not an oversight)", () => {
    for (const [method, sub] of PACKAGE_ROUTES) {
        it(`${method} ${UNSCOPED}${sub} is still served`, async () => {
            const r = await probe(method, `${UNSCOPED}${sub}`);
            expect(
                dispatcherAnswered(r),
                `${method} ${UNSCOPED}${sub} -> ${r.status} ${JSON.stringify(r.body)} — `
                + 'the unscoped package mount is ruled to stay under `required`; see the mount-site '
                + 'comment in dispatcher-plugin.ts before changing this',
            ).toBe(true);
        }, 60_000);
    }

    for (const [method, sub] of PACKAGE_ROUTES) {
        it(`${method} ${SCOPED}${sub} is served too — the scoped door is additive`, async () => {
            const r = await probe(method, `${SCOPED}${sub}`);
            expect(
                dispatcherAnswered(r),
                `${method} ${SCOPED}${sub} -> ${r.status} ${JSON.stringify(r.body)}`,
            ).toBe(true);
        }, 60_000);
    }
});

describe('#17432 — the siblings DO drop their unscoped mounts, which is what makes 404 a reading', () => {
    const DROPPED: Array<[string, string, string]> = [
        ['GET', `${PREFIX}/automation/flows`, 'automation'],
        ['POST', `${PREFIX}/actions/task/ping`, 'actions'],
    ];

    for (const [method, path, family] of DROPPED) {
        it(`${method} ${path} (${family}, unscoped) is NOT mounted under \`required\``, async () => {
            const r = await probe(method, path);
            expect(dispatcherAnswered(r)).toBe(false);
            expect(transportRefused(r), `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
        }, 60_000);
    }

    it('…while the same families ARE mounted scoped', async () => {
        const r = await probe('GET', `${PREFIX}/environments/${ENV_ID}/automation/flows`);
        expect(dispatcherAnswered(r), `scoped automation -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }, 60_000);
});
