// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16781 — the scoped `/packages` door on a `plugin-hono-server`-only host.
 *
 * ## The composition this file exists for
 *
 * A host composed as `plugin-hono-server` + the dispatcher with
 * `enableProjectScoping: true`, and **without** `@objectstack/hono`'s
 * `createHonoApp`, has exactly two ways a request can reach the `/packages`
 * domain: an explicit route this plugin mounts, or `createHonoApp`'s
 * `app.all(`${prefix}/*`)` catch-all — which this composition does not have.
 * `setFallbackHandler` is not a third: it is gated on `isAppEndpointPath`, so
 * a scoped package URL never reaches it.
 *
 * Before #16781 the plugin mounted `/packages*` at the UNSCOPED prefix only —
 * automation / actions / ai each had a scoped variant twenty lines away and
 * packages had none — so `GET /api/v1/environments/:id/packages` on this
 * composition was answered by the transport's own `notFound`. The domain
 * itself has handled scoped paths since #15859
 * (`packages-single-door.test.ts` pins that half); what was missing was the
 * MOUNT, and only a test that boots this composition over a real socket can
 * see the difference.
 *
 * ## The acceptance control, verbatim from the card
 *
 * > the same request on the same composition answers `ROUTE_NOT_FOUND`/bare
 * > 404 before and the dispatcher's row after.
 *
 * `dispatcherAnswered()` below is the discriminator, and it is a positive
 * test rather than "not a 404": the anonymous-deny floor (#7033/#7023) is the
 * FIRST statement in `handlePackagesRequest`, ahead of the registry probe, so
 * a credential-less request that REACHES the dispatcher is answered
 * `ANONYMOUS_DENY_STATUS` / `ANONYMOUS_DENY_CODE` — a verdict no
 * transport-level sink emits, since an unmounted path never gets past
 * `notFound`. The two constants are IMPORTED rather than spelled, so a rename
 * moves this file with them instead of quietly turning the discriminator into
 * a literal that nothing produces. The negative control immediately below
 * drives an unmounted sibling path through the same assertion and shows it
 * answering the transport's own 404 instead, so the discriminator is measured
 * in both directions rather than assumed.
 *
 * ## Why no credentials
 *
 * The claim under test is "a door exists here", and the anonymous floor is the
 * earliest observable proof of arrival — earlier than the 503 an unprovisioned
 * registry would give, and it cannot be produced by the transport. Provisioning
 * an authenticated caller would move the assertion downstream of two more gates
 * without making it say more about the mount. The RESPONSE SHAPES this card
 * also reconciles are pinned where they can be parsed against the spec, in
 * `domains/packages-read-delete-response-conformance.test.ts`.
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

/**
 * The composition named on the card: the hono TRANSPORT plugin plus the
 * dispatcher, scoping on. No `createHonoApp`, no `@objectstack/rest`, and no
 * service plugins — nothing here may supply a second door.
 */
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

async function probe(method: string, path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, { method });
    let body: any;
    try { body = await res.json(); } catch { body = undefined; }
    return { status: res.status, body };
}

/**
 * Did the DISPATCHER answer this request?
 *
 * The anonymous deny is minted inside `dispatcher.dispatch()` and by nothing
 * in the transport, so a true reading here means the request crossed the
 * mount. This is the card's "the dispatcher's row", stated as the thing that
 * is observable without credentials.
 */
function dispatcherAnswered(r: { status: number; body: any }): boolean {
    return r.status === ANONYMOUS_DENY_STATUS && r.body?.error?.code === ANONYMOUS_DENY_CODE;
}

/** The shape "no door answered" takes on this transport. */
function transportRefused(r: { status: number; body: any }): boolean {
    const code = r.body?.error?.code;
    return r.status === 404 && (code === undefined || code === 'ROUTE_NOT_FOUND' || code === 'ENDPOINT_NOT_FOUND');
}

const SCOPED = `${PREFIX}/environments/${ENV_ID}/packages`;
const UNSCOPED = `${PREFIX}/packages`;

/** The three routes the card names, plus the verb each is reached by. */
const CARD_ROUTES: Array<[string, string]> = [
    ['GET', ''],
    ['GET', `/${PKG_ID}`],
    ['DELETE', `/${PKG_ID}`],
];

describe('#16781 — the discriminator itself, measured in both directions', () => {
    it('POSITIVE CONTROL: the UNSCOPED door has always existed and answers from the domain', async () => {
        for (const [method, sub] of CARD_ROUTES) {
            const r = await probe(method, `${UNSCOPED}${sub}`);
            expect(dispatcherAnswered(r), `${method} ${UNSCOPED}${sub} -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
        }
    }, 60_000);

    it('NEGATIVE CONTROL: a scoped path no mount claims answers the transport, not the domain', async () => {
        const r = await probe('GET', `${PREFIX}/environments/${ENV_ID}/no-such-domain`);
        expect(dispatcherAnswered(r)).toBe(false);
        expect(transportRefused(r), `unmounted sibling -> ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }, 60_000);
});

describe('#16781 — the scoped /packages door on a plugin-hono-server-only composition', () => {
    for (const [method, sub] of CARD_ROUTES) {
        it(`${method} ${SCOPED}${sub} answers through the dispatcher`, async () => {
            const r = await probe(method, `${SCOPED}${sub}`);
            expect(
                dispatcherAnswered(r),
                `${method} ${SCOPED}${sub} -> ${r.status} ${JSON.stringify(r.body)}`,
            ).toBe(true);
        }, 60_000);
    }
});
