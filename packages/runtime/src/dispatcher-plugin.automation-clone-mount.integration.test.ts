// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20676 — the flow clone door is MOUNTED, at both bases `registerAutomationRoutes`
 * serves.
 *
 * ## Why a socket, and why this file beside the dogfood pin
 *
 * `domains/automation.ts` has answered `POST /:name/clone` (ADR-0126 §7.1)
 * since #12156, but the bridge mounts every `/automation` route explicitly and
 * never mounted this one, so on a real host the transport's `notFound`
 * answered before `dispatch()` ran. A test that calls the handler cannot see
 * that; only a request that crosses the mount can.
 * `qa/dogfood/test/automation-flow-clone-door.dogfood.test.ts` drives the
 * clone end to end on a composed app, but its harness boots the dispatcher
 * WITHOUT project scoping, so the environment-scoped twin
 * (`${prefix}/environments/:environmentId/automation/:name/clone`) is
 * unobservable there. This file boots the composition that mounts both.
 *
 * ## The composition, and the discriminator
 *
 * `plugin-hono-server` + the dispatcher, `enableProjectScoping: true` under
 * `projectResolution: 'auto'` — the branch that mounts the plain AND the
 * scoped base. No `createHonoApp`, no service plugins, so a mount is the only
 * way in. The discriminator is `dispatcher-plugin.scoped-packages-door.integration.test.ts`'s:
 * the automation domain's first statement is the anonymous-deny floor, so a
 * credential-less request that REACHES the dispatcher answers
 * `ANONYMOUS_DENY_STATUS` / `ANONYMOUS_DENY_CODE` (imported, not spelled) — a
 * verdict no transport-level sink emits — while a path no mount claims answers
 * the transport's own 404. The negative control measures that second direction
 * on a sibling path rather than assuming it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS, LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const PREFIX = '/api/v1';
const ENV_ID = 'env_alpha';
const FLOW = 'crm_convert_lead_wizard';

let kernel: LiteKernel | undefined;
let baseUrl = '';

beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(createDispatcherPlugin({
        prefix: PREFIX,
        scoping: { enableProjectScoping: true, projectResolution: 'auto' },
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

async function post(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'probe_clone_20676', label: 'Probe clone' }),
    });
    let body: any;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
}

/** The anonymous floor answered — minted inside `dispatch()`, never by the transport. */
function dispatcherAnswered(r: { status: number; body: any }): boolean {
    return r.status === ANONYMOUS_DENY_STATUS && r.body?.error?.code === ANONYMOUS_DENY_CODE;
}

/** The shape "no door answered" takes on this transport. */
function transportRefused(r: { status: number; body: any }): boolean {
    const code = r.body?.error?.code;
    return r.status === 404 && (code === undefined || code === 'ROUTE_NOT_FOUND' || code === 'ENDPOINT_NOT_FOUND');
}

describe('#20676 — the discriminator, measured in both directions', () => {
    // The control is the EXECUTION door, not `/:name/toggle`, on purpose: it has
    // the same two-segment POST shape and the same domain-wide anonymous floor,
    // and it sits outside every authoring gate, so its answer here does not
    // depend on what the toggle door does to a given flow. The control proves
    // one thing only — a mounted `/automation/:name/VERB` reaches `dispatch()`.
    it('POSITIVE CONTROL: the sibling `/:name/trigger` mount answers from the domain', async () => {
        const r = await post(`${PREFIX}/automation/${FLOW}/trigger`);
        expect(dispatcherAnswered(r), `trigger -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }, 60_000);

    it('NEGATIVE CONTROL: an unmounted sibling segment answers the transport, not the domain', async () => {
        const r = await post(`${PREFIX}/automation/${FLOW}/no-such-verb`);
        expect(dispatcherAnswered(r)).toBe(false);
        expect(transportRefused(r), `unmounted sibling -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }, 60_000);
});

describe('#20676 — POST /automation/:name/clone crosses the mount at both bases', () => {
    for (const base of [PREFIX, `${PREFIX}/environments/${ENV_ID}`]) {
        it(`POST ${base}/automation/:name/clone answers through the dispatcher`, async () => {
            const r = await post(`${base}/automation/${FLOW}/clone`);
            expect(dispatcherAnswered(r), `clone at ${base} -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
        }, 60_000);
    }
});
