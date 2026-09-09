// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15405] `GET /meta/object/:name/state/:field` tells a WIRED-AND-FAILING
 * engine apart from an ABSENT one — the SECOND consumer of the
 * `objectQLProvider` slot, which #13904's repair did not reach.
 *
 * ## The defect this file refuses
 *
 * `objectQLProvider` has two consumers in `rest-server.ts`. #13476 repaired
 * one, the `computeExecCtx` authorization-input seam, by reaching the provider
 * through `wiredEngineOrLoud` — which keeps "no engine is wired" and "the
 * engine WAS wired and could not be resolved" as two facts rather than one
 * `undefined`. This route, the other consumer, reached it through
 * `.catch(() => undefined)` and converted every rejection back into the same
 * `undefined` a never-registered engine produces, three lines before the answer
 * is chosen. So a wired-and-failing engine and a never-registered one both
 * answered `404 NOT_FOUND · "Object not found"`: a diagnostic route lying about
 * the cause during exactly the incident it would be consulted in.
 *
 * ⭐ The swallowed line was NEWLY load-bearing, which is why this is a defect
 * now and was not before. The shipped provider used to be
 * `try { … } catch { return undefined; }` and could not reject at all, so that
 * `.catch` was dead code. #13904 made the provider re-raise PRECISELY so a
 * consumer could see the outage; this consumer caught it straight back.
 *
 * ⛔ Not a defect in #13904, and nothing here is rework on it. That card's pins
 * are scoped to the `computeExecCtx` seam and they hold — §4 below READS one of
 * them and derives this route's expected answer FROM it.
 *
 * ## ⚠️ WHICH WIRING REACHES THIS CONSUMER — measured, not assumed
 *
 * The card does not say, and the answer narrows its claim. Every `/meta` route
 * is wrapped by `registerMetadataEndpoints`'s anonymous-deny gate, and that
 * gate resolves the SAME engine through `computeExecCtx` first. So this
 * consumer only gets to decide anything when the gate's own engine resolution
 * SUCCEEDED, and the gate has two branches that do not agree:
 *
 *   | gate's engine branch                     | on a broken engine        |
 *   |:-----------------------------------------|:--------------------------|
 *   | PROVIDER (`wiredEngineOrLoud`, no kernel)| RAISES — this consumer is |
 *   |                                          | never reached (§0)        |
 *   | KERNEL (`seamOrUndefined`, deliberately  | ABSORBS — this consumer   |
 *   | absorbing, `wiredEngineOrLoud` RESIDUE)  | decides ⇐ the defect      |
 *
 * ⇒ the collapse is reachable exactly where a kernel supplies auth and the
 * separately-wired `objectQLProvider` is broken: the MULTI-KERNEL deployments
 * (`rest-api-plugin.ts` wires a `kernelManager` when the host registers one).
 * ⛔ It is NOT reachable in a single-kernel boot such as `pnpm dev:crm`, where
 * the gate's provider branch raises first — §0 measures that rather than
 * asserting the card's broader wording. §1–§4 therefore drive the kernel-branch
 * wiring, which is where this line decides the answer.
 *
 * ## What is asserted, and why not just "503"
 *
 * ⭐ The subject is the DISTINCTION, not the status code. A build answering 503
 * for a wired-and-failing engine AND for a never-registered one would satisfy
 * every bare `expect(status).toBe(503)` while telling a NEW lie, so §2 asserts
 * the engine facts SIDE BY SIDE and asserts their INEQUALITY explicitly:
 *
 *   | engine fact                               | wire answer                |
 *   |:------------------------------------------|:---------------------------|
 *   | no provider wired at all                  | 404 NOT_FOUND ⭐ PIN        |
 *   | provider RESOLVES `undefined` (absence)   | 404 NOT_FOUND ⭐ PIN        |
 *   | provider REJECTS (wired, failed to build) | 503 SERVICE_UNAVAILABLE ⭐  |
 *   | provider THROWS SYNCHRONOUSLY (#13280)    | 503 SERVICE_UNAVAILABLE    |
 *
 * ⭐ The NEGATIVE CONTROL (§3) is the half that keeps this a restoration rather
 * than a behaviour change: on a HEALTHY engine, an object that genuinely does
 * not exist must still answer `404 NOT_FOUND`. If that moved, the repair
 * widened into something nobody ruled. §3 also serves a real answer from a real
 * registry, so no "404" here comes from an instrument that can only say 404.
 *
 * ⚠️ ENVELOPE, stated so nobody reads it as a second defect: the 503 arrives as
 * the FLAT `{ error: 'Internal server error', code }` every withheld 5xx on
 * this server wears (`handleRouteError` → #5437), while the sibling package
 * door emits its own nested `{ error: { code } }`. The two doors agree on the
 * pair that is the contract — STATUS and machine CODE — and differ only in
 * which emitter dresses it. That flat shape is pre-existing and pinned
 * elsewhere (`rest-server-meta-read-org-scope.test.ts` names it verbatim);
 * ⛔ it is not this card's to move.
 *
 * ## §5 — the same retired spelling at `emailServiceProvider`
 *
 * `POST /email/send` carried the other `.catch(() => undefined)` in this file.
 * ⚠️ It carries ONLY the second observation — no 404/503 question, and it is
 * NOT reachable from the shipped wiring (the provider `rest-api-plugin.ts`
 * hands over is declared `async`). It is covered here because it is the same
 * edit, ⛔ not on a claim of live impact. Its ANSWER is deliberately unchanged
 * at 501; what changed is that the synchronous fault shape now reaches that
 * same 501 instead of escaping to the route's own `500 EMAIL_SEND_FAILED`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
    isAuthzStoreUnavailableError,
    ObjectKernel,
} from '@objectstack/core';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const STATE_PATH = '/api/v1/meta/object/:name/state/:field';
const EMAIL_PATH = '/api/v1/email/send';
const OBJECT = { name: 'account', field: 'stage' };

// ---------------------------------------------------------------------------
// Harness — a real `RestServer` wired only at its CONSTRUCTOR seams, and a real
// `ObjectKernel` behind the kernelManager. ⛔ Nothing private is replaced and no
// fault is simulated by throwing a hand-made branded error into a stub: the
// kernel's "no such service" rejections are the registry's own, which is what
// makes the gate's absorb/raise split below a measurement.
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

/** A better-auth-shaped service resolving a real session. */
const authService = () => ({ api: { getSession: async () => ({ user: { id: 'u_admin' } }) } });

/**
 * A real kernel that has `auth` and NOTHING else. Asked for `objectql` (or
 * `tenancy`) it rejects with the registry's own branded "not registered", which
 * the gate absorbs — so the gate resolves a context and hands the engine
 * question on to the route. That is the whole reachability condition.
 */
function kernelWithAuthOnly(): ObjectKernel {
    const kernel = new ObjectKernel({
        logger: { level: 'error' },
        gracefulShutdown: false,
        skipSystemValidation: true,
    } as never);
    (kernel as unknown as { registerService(n: string, s: unknown): unknown }).registerService('auth', authService());
    return kernel;
}

interface Wiring {
    kernelManager?: any;
    defaultEnvironmentIdProvider?: any;
    authServiceProvider?: any;
    objectQLProvider?: any;
    emailServiceProvider?: any;
}

/** The multi-kernel host: the gate authenticates through a kernel it resolves. */
function kernelHost(): Wiring {
    const kernel = kernelWithAuthOnly();
    return {
        kernelManager: { getOrCreate: async () => kernel },
        defaultEnvironmentIdProvider: () => 'env_1',
    };
}

function serverWith(w: Wiring): RestServer {
    return new RestServer(
        mockServer() as any,
        capableProtocol() as any,
        {} as any,
        w.kernelManager,
        undefined,                  // envRegistry
        w.defaultEnvironmentIdProvider,
        w.authServiceProvider,
        w.objectQLProvider,
        w.emailServiceProvider,
    );
}

/**
 * What a door DID: it either answered on the wire, or the handler raised.
 * Both are recorded as VALUES rather than as assertions, because §0's subject
 * is precisely which of the two happens on which wiring.
 */
interface Settled { outcome: 'answered' | 'raised'; status: number; body: any; error?: unknown }

async function driveOn(rest: RestServer, method: string, path: string, req: Record<string, any> = {}): Promise<Settled> {
    const found = (rest as any).getRoutes().find(
        (r: any) => String(r.method).toUpperCase() === method && r.path === path,
    );
    if (!found) throw new Error(`route not registered: ${method} ${path}`);
    // `res.json(...)` with no preceding `res.status(...)` is a 200 on this
    // server, so the captured status starts there rather than at a sentinel.
    const captured: Settled = { outcome: 'answered', status: 200, body: undefined };
    const res: any = {
        json(body: unknown) { captured.body = body; return res; },
        send() { return res; },
        status(code: number) { captured.status = code; return res; },
        header() { return res; },
    };
    try {
        await found.handler({ params: {}, query: {}, headers: {}, body: {}, method, path, ...req }, res);
    } catch (error) {
        return { outcome: 'raised', status: captured.status, body: captured.body, error };
    }
    return captured;
}

function boot(w: Wiring): RestServer {
    const rest = serverWith(w);
    rest.registerRoutes();
    return rest;
}

/** Ask the state route about an object, on a freshly booted server. */
function driveState(w: Wiring, params: Record<string, string> = OBJECT): Promise<Settled> {
    return driveOn(boot(w), 'GET', STATE_PATH, { params });
}

/** The same, on the multi-kernel host where this consumer decides. */
function driveStateOnKernelHost(objectQLProvider: any, params: Record<string, string> = OBJECT): Promise<Settled> {
    return driveState({ ...kernelHost(), objectQLProvider }, params);
}

// --- the engine facts, as WIRINGS of the seam -------------------------------

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
 * declared type cannot prevent this and `RestServer`'s constructor is the
 * public wiring point; it throws before any promise exists, so a `.catch`
 * attached to the returned promise never sees it (#13280).
 */
const providerSyncThrowing = (() => { throw new Error('driver handshake failed'); }) as any;

const providerHealthy = async () => engineKnowing(['account']);

// ---------------------------------------------------------------------------
// 0. REACHABILITY — which wiring lets this consumer decide at all.
// ---------------------------------------------------------------------------

describe('[#15405] §0 reachability of this consumer, measured', () => {
    it('the route is behind the anonymous-deny gate — every case below authenticates', async () => {
        // Recorded because it is why this file boots a kernel at all: an
        // unauthenticated caller never reaches the engine question.
        const answer = await driveState({});
        expect(answer.outcome).toBe('answered');
        expect(answer.status).toBe(401);
        expect(answer.body?.code).toBe('UNAUTHENTICATED');
    });

    it('⚠️ single-kernel wiring: a broken engine raises at the GATE, so the collapse is NOT reachable there', async () => {
        // No kernelManager (the `pnpm dev:crm` shape). `computeExecCtx` takes
        // the PROVIDER branch, `wiredEngineOrLoud` raises, and the gate's
        // `rethrowAuthzStoreUnavailable` carries it out — this route's own
        // engine line never runs.
        //
        // ⭐ Asserted as the PROPERTY (not the 404 the card measured) rather
        // than as today's exact shape: how that raise reaches the wire is
        // another door's question and ⛔ not this card's to pin. §1 shows the
        // same instrument DOES produce `{ answered, 404 }`, so this is a real
        // discrimination and not an assertion that cannot fail.
        const seen = await driveState({ authServiceProvider: authService, objectQLProvider: providerRejecting });
        expect(seen).not.toMatchObject({ outcome: 'answered', status: 404 });
    });

    it('⭐ multi-kernel wiring: the gate ABSORBS and hands the engine question to this route', async () => {
        // The kernel branch (`seamOrUndefined`) absorbs by design — see
        // `wiredEngineOrLoud`'s RESIDUE note — so the gate resolves a context
        // and the route's own engine line is what decides. This is the
        // precondition every case in §1–§4 depends on; without it they would
        // all be measuring the gate.
        const seen = await driveStateOnKernelHost(providerHealthy);
        expect(seen.outcome).toBe('answered');
        expect(seen.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// 1. The two ABSENCE facts — unchanged, and pinned so the repair cannot move
//    them. These are the POSITIVE CONTROLS for "no accept set widened".
// ---------------------------------------------------------------------------

describe('[#15405] §1 an ABSENT engine still answers 404 — the supported shapes, untouched', () => {
    it('⭐ PIN: no `objectQLProvider` wired at all → 404 NOT_FOUND', async () => {
        // The embedder running REST with no data plane. `wiredEngineOrLoud` is
        // asked the wiring fact SEPARATELY and never calls the seam, so this
        // row cannot be reached by the loud path at all.
        const answer = await driveStateOnKernelHost(undefined);
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
        expect(answer.body?.error?.message).toBe('Object not found');
    });

    it('⭐ PIN: a provider that RESOLVES `undefined` → 404 NOT_FOUND', async () => {
        // The seam contract (`(environmentId?) => Promise<engine | undefined>`)
        // declaring absence rather than failing. ⛔ A repair that read this as
        // an outage would refuse a correctly-configured host.
        const answer = await driveStateOnKernelHost(providerAbsent);
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
    });
});

// ---------------------------------------------------------------------------
// 2. ⭐ THE DISCRIMINATION — the whole point of the card.
// ---------------------------------------------------------------------------

describe('[#15405] §2 a WIRED-AND-FAILING engine is no longer disguised as an absent one', () => {
    it('⭐ a REJECTING provider → 503 SERVICE_UNAVAILABLE, not 404', async () => {
        const answer = await driveStateOnKernelHost(providerRejecting);
        expect(answer.outcome).toBe('answered');
        expect(answer.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        // The machine code, at the position this server's withheld 5xx uses.
        expect(answer.body?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    });

    it('⭐ a NON-`async` provider that throws synchronously reaches the SAME answer (#13280)', async () => {
        // The asymmetry `.catch(() => undefined)` could not close: it attaches
        // to the promise the call RETURNS, so this shape escaped it entirely.
        const rejecting = await driveStateOnKernelHost(providerRejecting);
        const syncThrowing = await driveStateOnKernelHost(providerSyncThrowing);
        expect(syncThrowing.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(syncThrowing.body?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
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
            driveStateOnKernelHost(undefined),
            driveStateOnKernelHost(providerAbsent),
            driveStateOnKernelHost(providerRejecting),
        ]);
        expect([unwired.status, declaredAbsent.status, brokenEngine.status])
            .toEqual([404, 404, AUTHZ_STORE_UNAVAILABLE_STATUS]);
        expect(brokenEngine.status).not.toBe(unwired.status);
        expect(new Set([unwired.status, declaredAbsent.status, brokenEngine.status]).size).toBe(2);
        // …and the machine CODES differ too, so a client branching on the code
        // sees the split rather than only a status.
        expect(brokenEngine.body?.code).not.toBe(unwired.body?.error?.code);
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
        const answer = await driveStateOnKernelHost(providerHealthy, { name: 'no_such_object', field: 'stage' });
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code).toBe('NOT_FOUND');
        expect(answer.body?.error?.message).toBe('Object not found');
    });

    it('CONTROL: healthy engine, object that DOES exist → served', async () => {
        // Without this row every "404" above would be indistinguishable from an
        // instrument that cannot produce anything else.
        const answer = await driveStateOnKernelHost(providerHealthy);
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ object: 'account', field: 'stage' });
    });
});

// ---------------------------------------------------------------------------
// 4. ⭐ SIBLING AGREEMENT — this consumer answers what the OTHER consumer of
//    the same slot already answers, read OFF that sibling rather than
//    transcribed beside it.
// ---------------------------------------------------------------------------

describe('[#15405] §4 the two consumers of the `objectQLProvider` slot now agree', () => {
    it('⭐ the route\'s answer is DERIVED from the sibling seam\'s own error object', async () => {
        // The sibling is `computeExecCtx`'s data-engine seam, reached publicly
        // through `resolvePackageRouteExecutionContext`, which raises the
        // branded `AuthzStoreUnavailableError` (#13476) whose own `status` and
        // `code` the package door publishes. Reading them OFF that error —
        // rather than writing a second copy of the answer here — is what makes
        // this an agreement pin instead of two literals that can drift apart.
        //
        // ⚠️ TWO boots, necessarily: the sibling raises only on the PROVIDER
        // branch, and this route is only reached on the KERNEL branch (§0). The
        // engine FAULT is identical in both.
        const siblingErr: any = await serverWith({
            authServiceProvider: authService,
            objectQLProvider: providerRejecting,
        })
            .resolvePackageRouteExecutionContext({ params: {}, headers: {}, method: 'POST', path: '/api/v1/packages/publish' })
            .then(
                () => { throw new Error('the sibling seam unexpectedly fulfilled — this pin measured nothing'); },
                (e: unknown) => e,
            );
        expect(isAuthzStoreUnavailableError(siblingErr)).toBe(true);

        const answer = await driveStateOnKernelHost(providerRejecting);
        expect(answer.status).toBe(siblingErr.status);
        expect(answer.body?.code).toBe(siblingErr.code);
    });
});

// ---------------------------------------------------------------------------
// 5. The same retired spelling at `emailServiceProvider` — the OTHER site.
//    ⚠️ Second observation only: no 404/503 question, no shipped reachability.
// ---------------------------------------------------------------------------

/** `POST /email/send` gates on `enforceAuth`; the kernel host clears it. */
function driveEmail(emailServiceProvider: any): Promise<Settled> {
    return driveOn(boot({ ...kernelHost(), emailServiceProvider }), 'POST', EMAIL_PATH, {
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

    it('⭐ a NON-`async` provider throwing synchronously reaches that same 501, not the route\'s 500', async () => {
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
