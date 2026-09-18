// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18546] The `objectQLProvider` slot's consumer census, made MECHANICAL —
 * and its THIRD consumer, `POST /batch`, driven for the first time.
 *
 * ## Why this file exists
 *
 * #14251's phase-1 census settled the decidable test for "is a provider slot
 * ripe": a slot is ripe only when **no** consumer converts a rejection into
 * exactly the value its `undefined` path produces. Applying that test needs the
 * consumer set, and the consumer set has now been got wrong twice in a row, in
 * the same direction, by two different seats:
 *
 *   - the phase-1 census table listed **two** consumers for this slot;
 *   - #15405's repair, landed as PR #17077, opens with the same sentence —
 *     *"`objectQLProvider` has two consumers in `rest-server.ts`"*.
 *
 * ⭐ There are **three**, and the third was already on the tree the census was
 * taken against: `POST /batch` reads the field directly (`rest-server.ts`, the
 * cross-object transactional batch door). It is not hidden — the provider's own
 * docblock in `rest-api-plugin.ts` names it in as many words, *"the `transaction`
 * probe behind the batch routes"* — it was simply never enumerated, because both
 * enumerations were prose.
 *
 * ⚠️ **A consumer that cannot be seen and a consumer that does not exist look
 * exactly alike, and the correct actions are opposite.** A census written as
 * prose has no way to fail; this file gives it one. §1 enumerates the call sites
 * from the source text and pins the count, so a FOURTH consumer arriving
 * unexamined turns this red instead of being absorbed into a sentence.
 *
 * ## What is asserted about the answers
 *
 * §2 drives the third consumer on the wiring where it decides anything, and
 * asserts the DISTINCTION — not only a status code. Measured here, on
 * `POST /api/v1/batch`, MULTI-KERNEL wiring:
 *
 *   | engine fact                               | before #18559          | now                         |
 *   |:------------------------------------------|:-----------------------|:----------------------------|
 *   | no provider wired at all                  | 501 NOT_IMPLEMENTED    | 501 — unchanged             |
 *   | provider RESOLVES `undefined` (absence)   | 501 NOT_IMPLEMENTED    | 501 — unchanged             |
 *   | provider REJECTS (wired, failed to build) | **500 INTERNAL_ERROR** | **503 SERVICE_UNAVAILABLE** |
 *   | provider THROWS SYNCHRONOUSLY (#13280)    | **500 INTERNAL_ERROR** | **503 SERVICE_UNAVAILABLE** |
 *
 * ⇒ this consumer never re-collapsed: a rejection and a resolved `undefined`
 * always reached two different answers, which is the whole of the decidable
 * test, and #18559 is therefore ⛔ not a regression repair. ⭐ What changed is
 * HOW. It used to reach them through the handler's own outer `catch`
 * (`handleRouteError`) — a catch-all that knows nothing about this seam — and
 * now reaches them through the `wiredEngineOrLoud` seam its two siblings
 * already use. `expect(rejecting).not.toEqual(absent)` stays the load-bearing
 * assertion either way; the status pin is what says which mechanism answered.
 *
 * ⚠️ §2b is why the 500 was a DIVERGENCE rather than this door's answer. On the
 * SINGLE-KERNEL wiring — the composition the open core boots — this door already
 * answered `503` before #18559, because `computeExecCtx` takes its PROVIDER
 * branch there (`wiredEngineOrLoud`) and raises before the batch handler's own
 * engine line runs. The 500 was reachable only on the MULTI-KERNEL wiring, where
 * that gate's kernel branch absorbs by design (`wiredEngineOrLoud`'s RESIDUE
 * note) and hands the engine question down. ⇒ the repair did not pick a NEW wire
 * answer for this door; it removed a wiring-dependent divergence. §2b drives
 * both wirings side by side so that sentence is a reading and not an argument.
 *
 * ## Controls
 *
 * Both halves carry a control that can fail. §1's scanner is run against a
 * symbol known to be present (it must find sites) and against one known to be
 * absent (it must find none), so "3 sites" is a reading rather than the only
 * sentence the instrument can produce. §2 serves a REAL answer — 200 on a
 * healthy engine, 400 on a declared refusal — so no 501/503 below comes from an
 * instrument that can only report faults.
 *
 * ⚠️ The healthy control is deliberately driven with `{ operations: [] }` and
 * not with a real op. On the MULTI-KERNEL wiring a real op continues past this
 * door's engine line into `resolveProtocol`/`loadObjectItems`, which this
 * harness's auth-only kernel cannot serve — measured, that answers 500
 * INTERNAL_ERROR for a HEALTHY engine too, which would make a 500 read here
 * ambiguous between "the seam answered" and "the harness ran out of kernel".
 * The empty-operations body returns inside the door, after the engine line and
 * before the protocol is touched, so the engine fact is the only variable.
 *
 * ## What this file deliberately does NOT re-assert
 *
 * The other two consumers already have behavioural pins of their own and are
 * cited, not copied: `execctx-authz-input-seam-reachability.test.ts` (the
 * `computeExecCtx` authorization-input seam, #13476/#13904) and
 * `meta-state-route-engine-outage.test.ts` (`GET /meta/object/:name/state/:field`,
 * #15405). §3 asserts those files are still on disk and still name this slot, so
 * deleting the coverage reads as itself instead of shrinking this census
 * silently.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
    ObjectKernel,
} from '@objectstack/core';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');
const PLUGIN = readFileSync(resolve(HERE, 'rest-api-plugin.ts'), 'utf8');

const BATCH_PATH = '/api/v1/batch';

// ---------------------------------------------------------------------------
// §1 — the census, taken from the source text instead of from a sentence
// ---------------------------------------------------------------------------

/** A read of `this.<field>` that is code: comments and the assignment excluded. */
function readSites(source: string, field: string): Array<{ line: number; text: string }> {
    const sites: Array<{ line: number; text: string }> = [];
    source.split('\n').forEach((raw, i) => {
        const text = raw.trim();
        // Comment lines are not consumers. Both block-comment continuations
        // (` * …`) and line comments carry this field's name in this file.
        if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;
        if (!text.includes(`this.${field}`)) return;
        // The constructor's own assignment is the producer side, not a consumer.
        if (new RegExp(`this\\.${field}\\s*=[^=]`).test(text)) return;
        sites.push({ line: i + 1, text });
    });
    return sites;
}

/** The subset that CALLS the provider — one entry per consumer call site. */
function invocationSites(source: string, field: string) {
    return readSites(source, field).filter((s) => new RegExp(`this\\.${field}!?\\(`).test(s.text));
}

describe('[#18546] §1 the `objectQLProvider` consumer census is mechanical', () => {
    it('CONTROL: the scanner finds a site that is known to be there, and none for a name that is not', () => {
        // Positive: the authorization-input seam reads this field, and the
        // sibling `emailServiceProvider` field is read too. If either came back
        // empty the scanner would be reporting silence, not absence.
        expect(invocationSites(SOURCE, 'objectQLProvider').length).toBeGreaterThan(0);
        expect(readSites(SOURCE, 'emailServiceProvider').length).toBeGreaterThan(0);
        // Negative: a field that does not exist must read ZERO. This is what
        // makes a future zero mean "gone" rather than "the regex stopped
        // matching" — the failure mode that produced the two-consumer sentence
        // this file replaces.
        expect(readSites(SOURCE, 'objectQLProviderThatDoesNotExist')).toEqual([]);
        // And the scanner really does drop comment lines: this file's own
        // subject is quoted inside a retired-spelling comment in `rest-server.ts`.
        expect(SOURCE).toContain('this.objectQLProvider(environmentId).catch(() => undefined)');
        expect(invocationSites(SOURCE, 'objectQLProvider').some((s) => s.text.startsWith('//'))).toBe(false);
    });

    it('⭐ THREE consumers, not two — the count the two prose censuses got wrong', () => {
        const sites = invocationSites(SOURCE, 'objectQLProvider');
        // The message carries the sites, so a failure here hands the next
        // reader the new census instead of a bare number.
        expect(sites.map((s) => `L${s.line}: ${s.text}`).join('\n')).toBeTruthy();
        expect(sites).toHaveLength(3);
    });

    it('⭐ [#18559] ALL THREE consumers now reach the slot through `wiredEngineOrLoud` — none reads it directly', () => {
        const sites = invocationSites(SOURCE, 'objectQLProvider');
        const lines = SOURCE.split('\n');
        const viaSeam = sites.filter((s) => {
            // The helper is named on the line that OPENS the call, two lines up
            // from the invocation in all three spellings.
            return lines.slice(Math.max(0, s.line - 4), s.line).join('\n').includes('wiredEngineOrLoud(');
        });
        const direct = sites.filter((s) => !viaSeam.includes(s));
        // The message carries the offenders, so a failure hands the next reader
        // the site rather than a bare number.
        expect(direct.map((s) => `L${s.line}: ${s.text}`).join('\n')).toBe('');
        expect(direct).toHaveLength(0);
        expect(viaSeam).toHaveLength(3);

        // ⭐ CONTROL for the window predicate itself, on BOTH axes. It reads a
        // WINDOW of source text, so "3 of 3" is only a reading if the same
        // predicate can also say something else. `emailServiceProvider` is the
        // sibling slot whose one call site #15405 routed through the SWALLOWING
        // helper instead, so it is the natural negative:
        const wrappedIn = (field: string, helper: string) =>
            invocationSites(SOURCE, field).filter((s) =>
                lines.slice(Math.max(0, s.line - 4), s.line).join('\n').includes(helper));
        //   - the predicate must NOT claim that slot for `wiredEngineOrLoud`…
        expect(wrappedIn('emailServiceProvider', 'wiredEngineOrLoud(')).toHaveLength(0);
        //   - …and it must still FIRE for the helper that slot really uses, so
        //     the zero above is a discrimination and not a dead predicate.
        expect(wrappedIn('emailServiceProvider', 'seamOrUndefined(')).toHaveLength(1);

        // …and the batch door is one of the three, identified by the answer its
        // `undefined` path produces a few lines later — so "3 via the seam" is
        // pinned to include the consumer #18559 moved, not just its two siblings.
        const batch = viaSeam.filter((s) =>
            lines.slice(s.line, s.line + 6).join('\n').includes('Transactional batch not supported by this runtime'));
        expect(batch).toHaveLength(1);
    });

    it('⛔ the field is read only as `this.objectQLProvider` — no alias keeps a consumer out of this census', () => {
        // A dynamic read would be invisible to the scanner above, and TypeScript's
        // `private` is compile-time only, so the absence of these spellings is
        // what bounds the enumeration to what §1 can see.
        expect(SOURCE).not.toMatch(/\[\s*['"]objectQLProvider['"]\s*\]/);
        expect(SOURCE).not.toMatch(/as any\s*\)\s*\.objectQLProvider/);
        // And the shipped closure reaches `RestServer` through exactly one
        // construction site, so `rest-api-plugin.ts` cannot be wiring a second
        // consumer this file never looked at.
        expect(PLUGIN.match(/new RestServer\(/g) ?? []).toHaveLength(1);
        // The provider docblock already named the batch consumer; the census
        // tables did not. Pinned so the one true naming is not edited away.
        // (Wrapped across two comment lines in the source, so the pin stops at
        // the wrap rather than encoding this file's idea of where it breaks.)
        expect(PLUGIN).toContain('the `transaction` probe behind the batch');
    });
});

// ---------------------------------------------------------------------------
// Harness — a real `RestServer` wired only at its CONSTRUCTOR seams, and a real
// `ObjectKernel` behind the kernelManager. ⛔ Nothing private is replaced.
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
        createData: vi.fn().mockResolvedValue({ record: { id: '1' } }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
        batchData: vi.fn().mockResolvedValue({}),
    };
}

/** A better-auth-shaped service resolving a real session. */
const authService = () => ({ api: { getSession: async () => ({ user: { id: 'u_admin' } }) } });

/**
 * A real kernel that has `auth` and NOTHING else. Asked for `objectql` it
 * rejects with the registry's own branded "not registered", which the
 * `computeExecCtx` gate's KERNEL branch absorbs — so the gate resolves a context
 * and hands the engine question on to the route. That is the reachability
 * condition for this consumer, the same one `meta-state-route-engine-outage`
 * measured for the sibling door: on the PROVIDER branch the gate raises first
 * and this line never decides anything.
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
}

function kernelHost(): Wiring {
    const kernel = kernelWithAuthOnly();
    return {
        kernelManager: { getOrCreate: async () => kernel },
        defaultEnvironmentIdProvider: () => 'env_1',
    };
}

function boot(w: Wiring): RestServer {
    const rest = new RestServer(
        mockServer() as any,
        capableProtocol() as any,
        {} as any,
        w.kernelManager,
        undefined,                  // envRegistry
        w.defaultEnvironmentIdProvider,
        w.authServiceProvider,
        w.objectQLProvider,
    );
    rest.registerRoutes();
    return rest;
}

interface Answer { status: number; body: any }

async function driveBatch(w: Wiring, body: unknown): Promise<Answer> {
    const rest = boot(w);
    const found = (rest as any).getRoutes().find(
        (r: any) => String(r.method).toUpperCase() === 'POST' && r.path === BATCH_PATH,
    );
    if (!found) throw new Error(`route not registered: POST ${BATCH_PATH}`);
    // `res.json(...)` with no preceding `res.status(...)` is a 200 on this
    // server, so the captured status starts there rather than at a sentinel.
    const captured: Answer = { status: 200, body: undefined };
    const res: any = {
        json(b: unknown) { captured.body = b; return res; },
        send() { return res; },
        status(code: number) { captured.status = code; return res; },
        header() { return res; },
        setHeader() { return res; },
    };
    await found.handler(
        { params: {}, query: {}, headers: {}, body, method: 'POST', path: BATCH_PATH },
        res,
    );
    return captured;
}

const ONE_OP = { operations: [{ object: 'account', action: 'create', data: { name: 'a' } }] };

/** The seam contract DECLARING absence: resolves, quietly, with no engine. */
const providerAbsent = async () => undefined;
/** Wired and failed to build — a rejection, the shape #13904 made visible. */
const providerRejecting = async () => { throw new Error('driver handshake failed'); };
/** The same fault from a host that wired a NON-`async` provider (#13280). */
const providerSyncThrowing = (() => { throw new Error('driver handshake failed'); }) as any;
/** An engine that can open a transaction — enough to pass this door's probe. */
const engineHealthy = async () => ({ transaction: async (fn: any) => fn({}) });

// ---------------------------------------------------------------------------
// §2 — the third consumer, driven
// ---------------------------------------------------------------------------

describe('[#18546] §2 `POST /batch` — the slot\'s third consumer does not re-collapse', () => {
    it('CONTROL: a healthy engine is SERVED, so 501/503 is not all this instrument can say', async () => {
        // ⚠️ `{ operations: [] }` on purpose — see the file docblock's control
        // note. A real op continues past this door's engine line into
        // `resolveProtocol`, which this harness's auth-only kernel cannot serve,
        // and a HEALTHY engine then answers 500 too. The empty body returns
        // inside the door, so the engine fact stays the only variable.
        const served = await driveBatch({ ...kernelHost(), objectQLProvider: engineHealthy }, { operations: [] });
        expect(served.status).toBe(200);
        expect(served.body).toEqual({ results: [] });
        // A second non-fault answer, from the declared refusal one branch down:
        // the instrument reaches 4xx as well as 2xx.
        const refused = await driveBatch(
            { ...kernelHost(), objectQLProvider: engineHealthy },
            { ...ONE_OP, atomic: false },
        );
        expect(refused.status).toBe(400);
        expect(refused.body?.code).toBe('BATCH_NOT_ATOMIC');
    });

    it('no provider wired at all → 501 NOT_IMPLEMENTED', async () => {
        const answer = await driveBatch(kernelHost(), ONE_OP);
        expect(answer.status).toBe(501);
        expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
    });

    it('a provider RESOLVING `undefined` → the same 501: absence is the seam contract, not a fault', async () => {
        const answer = await driveBatch({ ...kernelHost(), objectQLProvider: providerAbsent }, ONE_OP);
        expect(answer.status).toBe(501);
        expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
    });

    it('⭐ a REJECTING provider reaches a DIFFERENT answer — the decidable test, asserted as the inequality', async () => {
        const absent = await driveBatch({ ...kernelHost(), objectQLProvider: providerAbsent }, ONE_OP);
        const rejecting = await driveBatch({ ...kernelHost(), objectQLProvider: providerRejecting }, ONE_OP);
        // THE assertion this file exists for: a rejection does not become the
        // value the `undefined` path produces. Side by side, and unequal.
        expect(rejecting.status).not.toBe(absent.status);
        expect(rejecting.body?.code).not.toBe(absent.body?.code);
        // ⭐ [#18559] THE PIN THAT MOVED. This read `500` / `INTERNAL_ERROR`
        // before the repair — the answer the handler's generic outer catch
        // produced — and reads the branded outage its two sibling consumers
        // already answer now that this door reaches the slot through
        // `wiredEngineOrLoud`. The two constants are `@objectstack/core`'s, so
        // the pin cannot drift from the helper that raises them.
        expect(rejecting.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(rejecting.status).toBe(503);
        expect(rejecting.body?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
        expect(rejecting.body?.code).toBe('SERVICE_UNAVAILABLE');
        // ⛔ And the fault MESSAGE is still withheld: what moved is the status
        // and the code, ⛔ never the prose. The driver's own sentence
        // ("driver handshake failed") must not appear on the wire.
        expect(rejecting.body?.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(rejecting.body)).not.toContain('driver handshake failed');
    });

    it('a NON-`async` provider throwing synchronously reaches that same answer, not the `undefined` path', async () => {
        // The field's declared type cannot prevent this shape and `RestServer`'s
        // constructor is the public wiring point. It throws before any promise
        // exists — inside the handler's `try`, so it lands where a rejection does.
        const syncThrowing = await driveBatch({ ...kernelHost(), objectQLProvider: providerSyncThrowing }, ONE_OP);
        const rejecting = await driveBatch({ ...kernelHost(), objectQLProvider: providerRejecting }, ONE_OP);
        expect(syncThrowing.status).toBe(rejecting.status);
        expect(syncThrowing.body?.code).toBe(rejecting.body?.code);
        expect(syncThrowing.body?.code).not.toBe('NOT_IMPLEMENTED');
    });
});

// ---------------------------------------------------------------------------
// §2b — [#18559] the SAME door on BOTH wirings. This is the section that says
// what the repair actually was: not a new wire answer for this door, but the
// removal of a divergence between two compositions of the same server.
// ---------------------------------------------------------------------------

/**
 * The SINGLE-KERNEL host — no `kernelManager`, auth reached through the
 * provider seam. This is the composition `pnpm dev:crm` and the open core boot,
 * and on it `computeExecCtx` resolves the engine through its PROVIDER branch,
 * which is `wiredEngineOrLoud`. A wired-and-failing engine therefore raises at
 * the GATE, before this door's own engine line is reached.
 */
function singleKernelHost(): Wiring {
    return { authServiceProvider: authService, defaultEnvironmentIdProvider: () => 'env_1' };
}

describe('[#18559] §2b the batch door answers ONE thing for one fact, on both wirings', () => {
    it('CONTROL: the single-kernel harness SERVES a real operation, so its 5xx below is a discrimination', async () => {
        // ⭐ This is the control the multi-kernel harness cannot give: here a
        // HEALTHY engine and a REAL op answer 200, so the 503 in the next case
        // is the engine fact and ⛔ not the harness running out of kernel.
        const served = await driveBatch({ ...singleKernelHost(), objectQLProvider: engineHealthy }, ONE_OP);
        expect(served.status).toBe(200);
        expect(served.body).toEqual({ results: [{ id: '1' }] });
    });

    it('⭐ single-kernel: a wired-and-failing engine answered 503 BEFORE this card too — the gate raises first', async () => {
        // ⛔ Not a claim this repair introduced: it is the reading that makes the
        // repair a de-divergence rather than a new ruling on a public door. The
        // gate's `wiredEngineOrLoud` raises `AuthzStoreUnavailableError` and the
        // handler's outer catch serves it with the branded status.
        const rejecting = await driveBatch({ ...singleKernelHost(), objectQLProvider: providerRejecting }, ONE_OP);
        expect(rejecting.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(rejecting.body?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    });

    it('⭐ the two wirings now AGREE for the identical engine fact', async () => {
        const single = await driveBatch({ ...singleKernelHost(), objectQLProvider: providerRejecting }, ONE_OP);
        const multi = await driveBatch({ ...kernelHost(), objectQLProvider: providerRejecting }, ONE_OP);
        // The whole of #18559, in one line: before the repair these two were
        // 503 and 500 for one fact, decided by which composition the operator
        // happened to be running.
        expect(multi.status).toBe(single.status);
        expect(multi.body?.code).toBe(single.body?.code);
    });

    it('⛔ and BOTH absence shapes still answer 501 on both wirings — no accept set moved', async () => {
        for (const host of [singleKernelHost(), kernelHost()]) {
            for (const provider of [undefined, providerAbsent]) {
                const answer = await driveBatch({ ...host, objectQLProvider: provider }, ONE_OP);
                expect(answer.status).toBe(501);
                expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
            }
        }
    });
});

// ---------------------------------------------------------------------------
// §3 — the other two consumers are covered elsewhere, by name
// ---------------------------------------------------------------------------

describe('[#18546] §3 the census names where the other two consumers are pinned', () => {
    it.each([
        ['execctx-authz-input-seam-reachability.test.ts', 'the computeExecCtx authorization-input seam'],
        ['meta-state-route-engine-outage.test.ts', 'GET /meta/object/:name/state/:field'],
    ])('%s still exists and still names this slot (%s)', (file) => {
        const path = resolve(HERE, file);
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, 'utf8')).toContain('objectQLProvider');
    });
});
