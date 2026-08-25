// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11806] Are `/meta/*` **READS** permission-filtered per user — on a boot
 * whose `auth` slot is a self-declared **stub** (`handlerReady: false`)?
 *
 * ## The question, and why the adjacent measurement does not answer it
 *
 * #11373 / PR #11472 measured the `/meta/*` **WRITE** doors (anonymous → 401,
 * member → 403 from the separate `manage_metadata` gate, dev admin → the door
 * runs and the PUT persists). That result is sound and is not in question here.
 * It is also not this question: refusing anonymous **writes** says nothing
 * about whether **reads** are permission-filtered, and #11373 booted the
 * showcase under **platform-default security**, which is a different boot class
 * from the one this file drives.
 *
 * ⛔ So this file deliberately does NOT boot the default stack again. It boots
 * the class that was never measured: an `auth` slot occupied by a service that
 * self-declares `{ status: 'stub', handlerReady: false }`, with **no `security`
 * service registered** — the shape a deployment has when auth is a stub rather
 * than a real identity provider.
 *
 * ## The three readings, and the control that makes them readable
 *
 * Every case drives the REAL dispatcher (`HttpDispatcher.dispatch`), so the
 * domain registry lookup and `resolveExecutionContext`'s identity resolution
 * are inside the measurement rather than assumed. `dispatch()` re-resolves
 * identity from the `auth` service and OVERWRITES any injected
 * `executionContext`, so the principal each case runs as is decided by the
 * request header the auth double reads — which is exactly how a real caller's
 * principal is decided.
 *
 *  1. **The door.** Anonymous `GET /meta/object/:name` → `401 UNAUTHENTICATED`.
 *     The anonymous-deny (`shouldDenyAnonymous`, unconditional since #3963 —
 *     its `requireAuth` opt-out is retired) inspects only the ALREADY-RESOLVED
 *     execution context. It never consults the auth service's `handlerReady`,
 *     so a stub in the slot does not open the door.
 *
 *  2. **The item read, two distinct principals.** Both are served, and the two
 *     bodies are **byte-identical**. With no `security` service the ADR-0106
 *     metadata-plane mask resolves to `passthrough` / reason `no-service`
 *     (D6 tier 1), so no per-caller projection runs at all.
 *
 *  3. **The type listing.** `GET /meta/types` reaches
 *     `protocol.getMetaTypes({})` — called with an EMPTY argument object. The
 *     caller's identity is not merely unused, it is not in scope, so this
 *     answer cannot vary by principal on any boot. Pinned by asserting the
 *     recorded call argument, not by comparing two bodies: comparing bodies
 *     alone would also pass if identity were passed and simply ignored today.
 *
 * ⭐ **The positive control is load-bearing** (case 4). A zero-hit reading —
 * "the two principals got the same bytes" — is worthless unless the apparatus
 * can be shown to SEE filtering where filtering exists. Case 4 re-runs the same
 * two principals down the same channel, changing exactly one thing: a
 * `security` service that answers a different readable-field set per caller. It
 * asserts the two bodies then DIFFER, and it records the `userId` the mask was
 * actually handed for each request.
 *
 * ⚠️ That recording is the other half of the control, and it is here because a
 * sibling pin in objectui (PR #6103) was found unable to detect the loss of the
 * protection it claimed to pin: its two-principal scenario had both principals
 * degenerate to the same anonymous identity, so no distinct-principal case
 * existed at all. `PRINCIPALS_SEEN_BY_THE_MASK` below asserts the two resolved
 * identities by NAME — not that there were two of them — so a boot that
 * collapsed both callers onto one principal fails this file instead of quietly
 * passing it.
 *
 * ## What this file does NOT measure
 *
 * ⛔ **Marketplace preview is not in here, because it does not exist in this
 * repo to boot.** `RuntimeMode`'s `'preview'` member and the whole
 * `KernelContext.previewMode` config block (`autoLogin`, `simulatedRole`,
 * `readOnly`, …) are DECLARED in `packages/spec` and read by nothing: no
 * runtime branches on `mode === 'preview'`, and `OS_PREVIEW_MODE`'s only
 * consumer widens the better-auth trusted-origin list in `cli/serve.ts`. A
 * preview boot is produced by the deployment layer, so its reading has to be
 * taken there. Writing a framework test that named itself after preview mode
 * would be the "measured the wrong boot and reported it as coverage" failure
 * this line of work exists to avoid.
 */

import { describe, it, expect, vi } from 'vitest';
import { SERVICE_SELF_INFO_KEY } from '@objectstack/spec/api';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { HttpDispatcher } from '../http-dispatcher.js';

/** The header the auth double reads to decide which principal a request is. */
const PRINCIPAL_HEADER = 'x-probe-principal';

const ALICE = 'u_alice';
const BOB = 'u_bob';

/**
 * The object schema under test. `secret_note` and `salary` exist so the control
 * has something to remove — a projection that removes nothing is not a
 * projection, and would make case 4 pass for the wrong reason.
 */
const STORED_SCHEMA = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        secret_note: { type: 'textarea' },
        salary: { type: 'currency' },
    },
};

/** What each principal may read, in the control boot only. */
const READABLE_BY_PRINCIPAL: Record<string, string[]> = {
    [ALICE]: ['id', 'name', 'secret_note'],
    [BOB]: ['id', 'name'],
};

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function boot(options: { security: 'none' | 'per-principal' }) {
    const getMetaItem = vi.fn(async ({ name }: any) => ({
        type: 'object',
        name,
        item: copy(STORED_SCHEMA),
    }));
    /**
     * The parameter is DECLARED, not incidental: the domain calls this as
     * `protocol.getMetaTypes({})`, and the case below asserts on the argument it
     * was handed. A zero-parameter double types `mock.calls` as an array of empty
     * tuples, so reading `[0][0]` off it is a type error (TS2493) — and typing the
     * argument away with `as any` would erase the very thing being pinned.
     */
    const getMetaTypes = vi.fn(async (_args: Record<string, unknown>) => (
        { types: ['object', 'app', 'plugin'] }
    ));
    const protocol = { getMetaItem, getMetaTypes };

    /**
     * The `auth` slot occupant for this boot: a service that SELF-DECLARES it is
     * a stub with no ready handler, which is the discovery shape the deployments
     * in question report. It answers a session only for a request carrying
     * `PRINCIPAL_HEADER`, so one boot serves the anonymous case and both
     * authenticated principals and the only difference on the wire is a header.
     */
    const auth = {
        [SERVICE_SELF_INFO_KEY]: { status: 'stub', handlerReady: false },
        api: {
            getSession: async ({ headers }: any) => {
                const id = headers?.get?.(PRINCIPAL_HEADER);
                return id ? { user: { id } } : undefined;
            },
        },
    };

    /** Every `userId` the mask was handed, in call order. Empty when no mask ran. */
    const principalsSeenByTheMask: (string | undefined)[] = [];
    const getMetadataReadableFields = vi.fn(async (_object: string, context: any) => {
        principalsSeenByTheMask.push(context?.userId);
        return READABLE_BY_PRINCIPAL[context?.userId] ?? [];
    });

    const services: Record<string, any> = { protocol, auth };
    if (options.security === 'per-principal') services.security = { getMetadataReadableFields };

    const get = (n: string) => services[n] ?? null;
    const kernel = {
        context: { getService: get },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    } as any;

    const dispatcher = new HttpDispatcher(kernel);

    /** Drive one request as `principal`, or anonymously when it is undefined. */
    const read = (path: string, principal?: string) => dispatcher.dispatch(
        'GET', path, undefined, {},
        {
            environmentId: 'platform',
            request: { headers: principal ? { [PRINCIPAL_HEADER]: principal } : {} },
        } as any,
    );

    return { read, getMetaItem, getMetaTypes, principalsSeenByTheMask };
}

const fieldsOf = (res: any): string[] => Object.keys(res?.response?.body?.data?.item?.fields ?? {}).sort();

describe('#11806 — /meta READS on a stub-auth (handlerReady:false) boot', () => {
    describe('the door: a stub in the auth slot does not open it', () => {
        it('anonymous GET /meta/object/:name → 401 UNAUTHENTICATED, and the read never runs', async () => {
            const stack = boot({ security: 'none' });

            const res = await stack.read('/meta/object/account');

            // ADR-0112 envelope — the code AND the status, never a bare "it failed".
            expect(res.response?.status).toBe(ANONYMOUS_DENY_STATUS);
            expect(res.response?.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
            expect(res.response?.body?.error?.message).toBe(ANONYMOUS_DENY_MESSAGE);
            expect(res.response?.body?.success).toBe(false);

            // Nothing was fetched, so nothing could have been disclosed and
            // nothing could have been cached by a client.
            expect(stack.getMetaItem).not.toHaveBeenCalled();
        });

        it('anonymous GET /meta/types → 401 too — the listing is behind the same door', async () => {
            const stack = boot({ security: 'none' });

            const res = await stack.read('/meta/types');

            expect(res.response?.status).toBe(ANONYMOUS_DENY_STATUS);
            expect(res.response?.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
            expect(stack.getMetaTypes).not.toHaveBeenCalled();
        });
    });

    describe('the reading: served answers do not vary by principal', () => {
        it('two DISTINCT principals receive byte-identical /meta/object/:name bodies', async () => {
            const stack = boot({ security: 'none' });

            const asAlice = await stack.read('/meta/object/account', ALICE);
            const asBob = await stack.read('/meta/object/account', BOB);

            expect(asAlice.response?.status).toBe(200);
            expect(asBob.response?.status).toBe(200);

            // The whole schema, both times — `secret_note` and `salary` included.
            expect(fieldsOf(asAlice)).toEqual(['id', 'name', 'salary', 'secret_note']);
            expect(fieldsOf(asBob)).toEqual(['id', 'name', 'salary', 'secret_note']);

            // Byte-identical, which is the claim: with no `security` service the
            // ADR-0106 posture is `passthrough` / `no-service`, so no per-caller
            // projection runs. Compared as serialized bytes because that is what
            // a client would cache.
            expect(JSON.stringify(asBob.response?.body))
                .toBe(JSON.stringify(asAlice.response?.body));

            // No mask ran at all — the stronger statement than "the bodies matched".
            expect(stack.principalsSeenByTheMask).toEqual([]);
        });

        it('GET /meta/types is answered with no caller identity in scope at all', async () => {
            const stack = boot({ security: 'none' });

            const asAlice = await stack.read('/meta/types', ALICE);
            const asBob = await stack.read('/meta/types', BOB);

            expect(asAlice.response?.status).toBe(200);
            expect(asBob.response?.status).toBe(200);
            expect(JSON.stringify(asBob.response?.body))
                .toBe(JSON.stringify(asAlice.response?.body));

            // THE point: the type listing is not "filtered and found equal", it is
            // resolved from an argument object that carries no principal. Asserted
            // on the recorded call, because equal bodies alone would also hold if
            // identity were passed and merely ignored today.
            expect(stack.getMetaTypes).toHaveBeenCalledTimes(2);
            expect(stack.getMetaTypes.mock.calls[0][0]).toEqual({});
            expect(stack.getMetaTypes.mock.calls[1][0]).toEqual({});
        });
    });

    describe('positive control: the same apparatus DOES see filtering where filtering exists', () => {
        it('with a per-principal security service the two bodies differ, and the two principals are named', async () => {
            const stack = boot({ security: 'per-principal' });

            const asAlice = await stack.read('/meta/object/account', ALICE);
            const asBob = await stack.read('/meta/object/account', BOB);

            expect(asAlice.response?.status).toBe(200);
            expect(asBob.response?.status).toBe(200);

            // Filtering is visible: each caller's unreadable fields are removed
            // WHOLE (ADR-0106 D1), and the two answers are different documents.
            expect(fieldsOf(asAlice)).toEqual(['id', 'name', 'secret_note']);
            expect(fieldsOf(asBob)).toEqual(['id', 'name']);
            expect(JSON.stringify(asBob.response?.body))
                .not.toBe(JSON.stringify(asAlice.response?.body));

            // ⭐ The principals are pinned by NAME, not counted. A boot that
            // collapsed both callers onto one identity — the degenerate shape
            // that made a sibling pin unable to detect what it claimed to pin —
            // fails here rather than passing quietly.
            expect(stack.principalsSeenByTheMask).toEqual([ALICE, BOB]);
        });
    });
});
