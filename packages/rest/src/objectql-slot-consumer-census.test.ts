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
 * asserts the DISTINCTION — not a status code. Measured here, on
 * `POST /api/v1/batch`:
 *
 *   | engine fact                                | wire answer                |
 *   |:-------------------------------------------|:---------------------------|
 *   | no provider wired at all                   | 501 NOT_IMPLEMENTED        |
 *   | provider RESOLVES `undefined` (absence)    | 501 NOT_IMPLEMENTED        |
 *   | provider REJECTS (wired, failed to build)  | 500 INTERNAL_ERROR         |
 *   | provider THROWS SYNCHRONOUSLY (#13280)     | 500 INTERNAL_ERROR         |
 *
 * ⇒ this consumer does **not** re-collapse: a rejection and a resolved
 * `undefined` reach two different answers, which is the whole of the decidable
 * test. It reaches them through the handler's own outer `catch`
 * (`handleRouteError`) rather than through the `wiredEngineOrLoud` seam its two
 * siblings use.
 *
 * ⛔ **500 is RECORDED here, not ruled.** The other two consumers of this same
 * slot answer `503 SERVICE_UNAVAILABLE` for the identical fact. Whether this
 * door should join them is a public-door wire change and needs the per-consumer
 * ruling #14251 reserves for exactly this; ⛔ nothing here asserts that 500 is
 * correct, and ⛔ nothing here moves it. What is load-bearing is
 * `expect(rejecting).not.toEqual(absent)` — if a later edit collapses the two,
 * this file says so.
 *
 * ## Controls
 *
 * Both halves carry a control that can fail. §1's scanner is run against a
 * symbol known to be present (it must find sites) and against one known to be
 * absent (it must find none), so "3 sites" is a reading rather than the only
 * sentence the instrument can produce. §2 serves a REAL answer — 200 on a
 * healthy engine, 400 on a declared refusal — so no 501/500 below comes from an
 * instrument that can only report faults.
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
import { ObjectKernel } from '@objectstack/core';
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

    it('two consumers reach the slot through `wiredEngineOrLoud`; the third does not', () => {
        const sites = invocationSites(SOURCE, 'objectQLProvider');
        const viaSeam = sites.filter((s) => {
            const lines = SOURCE.split('\n');
            // The helper is named on the line that OPENS the call, two lines up
            // from the invocation in both existing spellings.
            return lines.slice(Math.max(0, s.line - 4), s.line).join('\n').includes('wiredEngineOrLoud(');
        });
        expect(viaSeam).toHaveLength(2);

        const direct = sites.filter((s) => !viaSeam.includes(s));
        expect(direct).toHaveLength(1);
        // …and the one that does not is the cross-object batch door, identified
        // by the answer its `undefined` path produces twelve characters later.
        const after = SOURCE.split('\n').slice(direct[0]!.line, direct[0]!.line + 6).join('\n');
        expect(after).toContain('Transactional batch not supported by this runtime');
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
    it('CONTROL: a healthy engine is SERVED, so 501/500 is not all this instrument can say', async () => {
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
        // Today's answer, RECORDED so a change is legible — ⛔ not ruled correct.
        // Its two sibling consumers answer 503 for this same fact; whether this
        // door joins them is the per-consumer ruling #14251 reserves.
        expect(rejecting.status).toBe(500);
        expect(rejecting.body?.code).toBe('INTERNAL_ERROR');
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
