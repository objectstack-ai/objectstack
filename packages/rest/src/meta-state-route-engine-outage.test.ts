// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15405] `GET /meta/object/:name/state/:field` tells a WIRED-AND-FAILING
 * engine apart from an ABSENT one — the SECOND consumer of the
 * `objectQLProvider` slot, which #13904's repair did not reach.
 *
 * ## The defect this file refuses
 *
 * `objectQLProvider` has two consumers in `rest-server.ts`. #13476 repaired one
 * of them, the `computeExecCtx` authorization-input seam, by reaching the
 * provider through `wiredEngineOrLoud` — which keeps "no engine is wired" and
 * "the engine WAS wired and could not be resolved" as two facts rather than one
 * `undefined`. The other consumer, this route, reached it through
 * `.catch(() => undefined)` and converted every rejection back into the same
 * `undefined` a never-registered engine produces, three lines before the answer
 * is chosen. So a wired-and-failing engine and a never-registered one both
 * answered `404 NOT_FOUND · "Object not found"`: a diagnostic route lying about
 * the cause during exactly the incident it would be consulted in.
 *
 * ⭐ The swallowed line was NEWLY load-bearing, which is why this is a defect
 * now and was not one before. The shipped provider used to be
 * `try { … } catch { return undefined; }` and could not reject at all, so that
 * `.catch` was dead code. #13904 made the provider re-raise PRECISELY so a
 * consumer could see the outage; this consumer caught it straight back.
 *
 * ⛔ Not a defect in #13904, and nothing here is rework on it. That card's pins
 * are scoped to the `computeExecCtx` seam and they hold — §4 below READS one of
 * them, on the same boot, and derives this route's expected answer FROM it.
 *
 * ## What is asserted, and why not just "503"
 *
 * ⭐ The subject is the DISTINCTION, not the status code. A build that answered
 * 503 for a wired-and-failing engine AND for a never-registered one would
 * satisfy every bare `expect(status).toBe(503)` while telling a NEW lie, so
 * §2 asserts the three engine facts SIDE BY SIDE and asserts their INEQUALITY
 * explicitly:
 *
 *   | engine fact                              | wire answer                |
 *   |:-----------------------------------------|:---------------------------|
 *   | no provider wired at all                 | 404 NOT_FOUND ⭐ PIN        |
 *   | provider RESOLVES `undefined` (absence)  | 404 NOT_FOUND ⭐ PIN        |
 *   | provider REJECTS (wired, failed to build)| 503 SERVICE_UNAVAILABLE ⭐  |
 *   | provider THROWS SYNCHRONOUSLY (#13280)   | 503 SERVICE_UNAVAILABLE    |
 *
 * ⭐ The NEGATIVE CONTROL (§3) is the half that keeps this a restoration rather
 * than a behaviour change: on a HEALTHY engine, an object that genuinely does
 * not exist must still answer `404 NOT_FOUND`, byte-identically. If that moved,
 * the repair widened into something nobody ruled.
 *
 * ⭐ And a control board, because a file whose every row says "404" from an
 * instrument never shown capable of a 200 has measured its own harness: §3 also
 * serves a real answer from a real registry on the same instrument.
 *
 * ## §5 — the same retired spelling at `emailServiceProvider`
 *
 * `POST /email/send` carried the other `.catch(() => undefined)` in this file.
 * ⚠️ It carries ONLY the second observation — no 404/503 question, and it is
 * NOT reachable from the shipped wiring (the provider `rest-api-plugin.ts`
 * hands over is declared `async`). It is covered here because it is the same
 * edit, ⛔ not on a claim of live impact. Its ANSWER is deliberately unchanged
 * at 501; what changed is that the synchronous fault shape now reaches that
 * same 501 instead of escaping to the route's `500 EMAIL_SEND_FAILED` catch.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
    isAuthzStoreUnavailableError,
} from '@objectstack/core';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const STATE_PATH = '/api/v1/meta/object/:name/state/:field';
const EMAIL_PATH = '/api/v1/email/send';

// ---------------------------------------------------------------------------
// Harness — a real `RestServer`, wired only at its CONSTRUCTOR seams. Nothing
// private is replaced on the engine-seam instances, so the code under test is
// the shipped path.
// ---------------------------------------------------------------------------

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function capableProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({}),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
}

interface Wiring {
    authServiceProvider?: any;
    objectQLProvider?: any;
    emailServiceProvider?: any;
}

/**
 * ⚠️ `kernelManager` is deliberately ABSENT. The engine seam has two branches
 * and only the PROVIDER one is this card's subject; with a kernelManager wired,
 * `computeExecCtx` would take the kernel branch, which absorbs on purpose
 * (`wiredEngineOrLoud`'s RESIDUE note) and would measure the wrong thing.
 */
function serverWith(w: Wiring): RestServer {
    return new RestServer(
        mockServer() as any,
        capableProtocol() as any,
        { api: { requireAuth: false } } as any,
        undefined,                  // kernelManager
        undefined,                  // envRegistry
        undefined,                  // defaultEnvironmentIdProvider
        w.authServiceProvider,
        w.objectQLProvider,
        w.emailServiceProvider,
    );
}

interface Captured { status: number; body: any }

/**
 * `res.json(...)` with no preceding `res.status(...)` is a 200 on this server,
 * so the captured status starts there rather than at a sentinel — a sentinel
 * would make the served answer indistinguishable from "the handler never
 * answered", and §3's control depends on telling those apart.
 */
function driveOn(rest: RestServer, method: string, path: string, req: Record<string, any> = {}): Promise<Captured> {
    const found = (rest as any).getRoutes().find(
        (r: any) => String(r.method).toUpperCase() === method && r.path === path,
    );
    if (!found) throw new Error(`route not registered: ${method} ${path}`);
    const captured: Captured = { status: 200, body: undefined };
    const res: any = {
        json(body: unknown) { captured.body = body; return res; },
        send() { return res; },
        status(code: number) { captured.status = code; return res; },
        header() { return res; },
    };
    return Promise.resolve(found.handler({ params: {}, query: {}, headers: {}, body: {}, method, path, ...req }, res))
        .then(() => captured);
}

/** Boot a server with `wire` and ask the state route about `account.stage`. */
async function driveState(w: Wiring, params: Record<string, string> = { name: 'account', field: 'stage' }): Promise<Captured> {
    const rest = serverWith(w);
    rest.registerRoutes();
    return driveOn(rest, 'GET', STATE_PATH, { params });
}

// ---------------------------------------------------------------------------
// Engine fixtures — the three registry facts, driven as WIRINGS of the seam.
// ---------------------------------------------------------------------------

/** A registry that answers for the objects it was given, and only those. */
const engineKnowing = (names: string[]) => ({
    registry: { getObject: (name: string) => (names.includes(name) ? { name, fields: {} } : undefined) },
});

/** The seam contract DECLARING absence: resolves, quietly, with no engine. */
const providerAbsent = async () => undefined;

/** Wired and failed to build — a rejection, the shape #13904 made visible. */
const providerRejecting = async () => { throw new Error('driver handshake failed'); };

/**
 * The same fault from a host that wired a NON-`async` provider. The seam's
 * declared type cannot prevent this, and it throws before any promise exists —
 * so a `.catch` attached to the returned promise never sees it (#13280).
 */
const providerSyncThrowing = (() => { throw new Error('driver handshake failed'); }) as any;

/** A better-auth-shaped service resolving a real session, for §4. */
const AUTH_OK = async () => ({ api: { getSession: async () => ({ user: { id: 'u_admin' } }) } });

// ---------------------------------------------------------------------------
// 1. The two ABSENCE facts — unchanged, and pinned so the repair cannot move
//    them. These are the POSITIVE CONTROLS for "no accept set widened".
// ---------------------------------------------------------------------------

describe('[#15405] §1 an ABSENT engine still answers 404 — the supported shapes, untouched', () => {
    it('⭐ PIN: no `objectQLProvider` wired at all → 404 NOT_FOUND', async () => {
        // The embedder running REST with no data plane. `wiredEngineOrLoud` is
        // asked the wiring fact SEPARATELY and never calls the seam, so this
        // row cannot be reached by the loud path at all.
        const answer = await driveState({});
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
        expect(answer.body?.error?.message).toBe('Object not found');
    });

    it('⭐ PIN: a provider that RESOLVES `undefined` → 404 NOT_FOUND', async () => {
        // The seam contract (`(environmentId?) => Promise<engine | undefined>`)
        // declaring absence rather than failing. ⛔ A repair that read this as
        // an outage would refuse a correctly-configured host.
        const answer = await driveState({ objectQLProvider: providerAbsent });
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
    });
});

// ---------------------------------------------------------------------------
// 2. ⭐ THE DISCRIMINATION — the whole point of the card.
// ---------------------------------------------------------------------------

describe('[#15405] §2 a WIRED-AND-FAILING engine is no longer disguised as an absent one', () => {
    it('⭐ a REJECTING provider → 503 SERVICE_UNAVAILABLE, not 404', async () => {
        const answer = await driveState({ objectQLProvider: providerRejecting });
        // ADR-0112 envelope discipline: the pair, at the nested position.
        expect(answer.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(answer.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    });

    it('⭐ a NON-`async` provider that throws synchronously reaches the SAME answer (#13280)', async () => {
        // The asymmetry `.catch(() => undefined)` could not close: it attaches
        // to the promise the call RETURNS, so this shape escaped it entirely.
        const rejecting = await driveState({ objectQLProvider: providerRejecting });
        const syncThrowing = await driveState({ objectQLProvider: providerSyncThrowing });
        expect(syncThrowing.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(syncThrowing.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
        // Asserted as an EQUALITY, because "the host happened to declare its
        // provider `async`" deciding the wire answer is the defect itself.
        expect(syncThrowing.status).toBe(rejecting.status);
    });

    it('⭐ THE DISTINCTION: absence and outage are two answers, not one', async () => {
        // ⛔ This is the assertion a bare `toBe(503)` cannot make. A build that
        // answered 503 for BOTH facts would pass every case above and tell a
        // NEW lie; a build that answered 404 for both is the defect this card
        // filed. Only a two-valued table satisfies this.
        const [unwired, declaredAbsent, brokenEngine] = await Promise.all([
            driveState({}),
            driveState({ objectQLProvider: providerAbsent }),
            driveState({ objectQLProvider: providerRejecting }),
        ]);
        expect([unwired.status, declaredAbsent.status, brokenEngine.status])
            .toEqual([404, 404, AUTHZ_STORE_UNAVAILABLE_STATUS]);
        expect(brokenEngine.status).not.toBe(unwired.status);
        expect(new Set([unwired.status, declaredAbsent.status, brokenEngine.status]).size).toBe(2);
        // …and the CODES differ too, so a client branching on `error.code`
        // (ADR-0112's declared position) sees the split, not only a status.
        expect(brokenEngine.body?.error?.code).not.toBe(unwired.body?.error?.code);
    });
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE CONTROL + control board — the repair moved the outage row and
//    NOTHING else, on an instrument shown capable of serving.
// ---------------------------------------------------------------------------

describe('[#15405] §3 a healthy engine is untouched — the negative control', () => {
    it('⭐ NEGATIVE CONTROL: healthy engine, object that genuinely does not exist → 404 NOT_FOUND', async () => {
        // ⛔ If this row moves, the repair widened into a behaviour change
        // nobody ruled: "this object does not exist" is not an outage.
        const answer = await driveState(
            { objectQLProvider: async () => engineKnowing(['account']) },
            { name: 'no_such_object', field: 'stage' },
        );
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
        expect(answer.body?.error?.message).toBe('Object not found');
    });

    it('CONTROL: healthy engine, object that DOES exist → served, not 404 and not 503', async () => {
        // Without this row every "404" above would be indistinguishable from an
        // instrument that cannot produce anything else.
        const answer = await driveState({ objectQLProvider: async () => engineKnowing(['account']) });
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ object: 'account', field: 'stage' });
    });
});

// ---------------------------------------------------------------------------
// 4. ⭐ SIBLING AGREEMENT — this consumer answers what the OTHER consumer of
//    the same slot already answers, read off that sibling on the SAME boot.
// ---------------------------------------------------------------------------

describe('[#15405] §4 the two consumers of the `objectQLProvider` slot now agree', () => {
    it('⭐ the route\'s answer is DERIVED from the sibling seam\'s own error, not transcribed', async () => {
        // One `RestServer`, one failing provider, both consumers asked.
        //
        // The sibling is `computeExecCtx`'s data-engine seam, reached publicly
        // through `resolvePackageRouteExecutionContext`. It raises the branded
        // `AuthzStoreUnavailableError` (#13476), whose OWN `status` and `code`
        // are what the package door publishes. Reading them off that instance
        // — rather than hard-coding a second copy of the answer here — is what
        // makes this an agreement pin instead of two independent literals that
        // can drift apart silently.
        const rest = serverWith({ authServiceProvider: AUTH_OK, objectQLProvider: providerRejecting });
        rest.registerRoutes();

        const siblingErr: any = await rest
            .resolvePackageRouteExecutionContext({ params: {}, headers: {}, method: 'POST', path: '/api/v1/packages/publish' })
            .then(
                () => { throw new Error('the sibling seam unexpectedly fulfilled — this pin measured nothing'); },
                (e: unknown) => e,
            );
        expect(isAuthzStoreUnavailableError(siblingErr)).toBe(true);

        const answer = await driveOn(rest, 'GET', STATE_PATH, { params: { name: 'account', field: 'stage' } });
        expect(answer.status).toBe(siblingErr.status);
        expect(answer.body?.error?.code).toBe(siblingErr.code);
    });
});

// ---------------------------------------------------------------------------
// 5. The same retired spelling at `emailServiceProvider` — the OTHER site.
//    ⚠️ Second observation only: no 404/503 question, no shipped reachability.
// ---------------------------------------------------------------------------

/** `POST /email/send` sits behind the auth gate; clear it the way #7035 does. */
async function driveEmail(emailServiceProvider: any): Promise<Captured> {
    const rest = serverWith({ emailServiceProvider });
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u_admin' });
    rest.registerRoutes();
    return driveOn(rest, 'POST', EMAIL_PATH, {
        body: { to: 'a@example.com', subject: 's', text: 't' },
    });
}

describe('[#15405] §5 `POST /email/send` — both fault shapes reach the SAME 501', () => {
    it('CONTROL: a working email service is served, so 501 is not all this instrument can say', async () => {
        const answer = await driveEmail(async () => ({ send: async () => ({ status: 'sent', id: 'm_1' }) }));
        expect(answer.status).toBe(200);
        expect(answer.body?.status).toBe('sent');
    });

    it('a REJECTING provider is absorbed → 501 NOT_IMPLEMENTED, unchanged', async () => {
        const answer = await driveEmail(async () => { throw new Error('mail transport unavailable'); });
        expect(answer.status).toBe(501);
        expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
    });

    it('⭐ a NON-`async` provider throwing synchronously reaches that same 501, instead of the route\'s 500', async () => {
        // Before the repair this shape escaped the `.catch` — which did not
        // exist yet at the moment of the throw — and landed in the handler's
        // own catch as `500 EMAIL_SEND_FAILED`. Two answers for one fault,
        // chosen by whether the host wrote `async`.
        const rejecting = await driveEmail(async () => { throw new Error('mail transport unavailable'); });
        const syncThrowing = await driveEmail((() => { throw new Error('mail transport unavailable'); }) as any);
        expect(syncThrowing.status).toBe(501);
        expect(syncThrowing.body?.code).toBe('NOT_IMPLEMENTED');
        expect(syncThrowing.status).toBe(rejecting.status);
        // The answer it must NOT be — named, so a regression reads as itself.
        expect(syncThrowing.body?.code).not.toBe('EMAIL_SEND_FAILED');
    });
});
