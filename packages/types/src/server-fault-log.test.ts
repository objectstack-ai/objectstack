// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14310] The shared "a 5xx is never silent" rule, pinned on its own.
 *
 * The transports each pin the rule from their own side
 * (`packages/runtime/src/dispatcher-5xx-always-logged.test.ts`); this file
 * pins the rule itself, so a door that starts disagreeing with it turns red
 * here rather than in one consumer's suite only.
 *
 * The band boundary is the assertion that matters most. "4xx may stay quiet;
 * 5xx never" is a contract sentence, and 499/500 is where a refactor would
 * silently move it.
 */

import { describe, it, expect, vi } from 'vitest';

import {
    logServerFault,
    isServerFault,
    serverFaultLogMessage,
    serverFaultLogMeta,
    describeFaultRequest,
    SERVER_FAULT_LOG_PREFIX,
} from './server-fault-log.js';
import { sendError } from './response-envelope.js';

const spyLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
});

describe('isServerFault — the band', () => {
    it('is exactly "at or above 500"', () => {
        expect(isServerFault(499)).toBe(false);
        expect(isServerFault(500)).toBe(true);
        expect(isServerFault(503)).toBe(true);
        expect(isServerFault(200)).toBe(false);
    });
});

describe('logServerFault', () => {
    it('emits nothing for a 4xx, and says so in its return value', () => {
        const logger = spyLogger();
        expect(logServerFault({ status: 404, error: new Error('nope') }, logger)).toBe(false);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    });

    it('emits exactly one record, at ERROR level, for a 5xx', () => {
        const logger = spyLogger();
        expect(logServerFault({ status: 500, error: new Error('kaboom') }, logger)).toBe(true);

        expect(logger.error).toHaveBeenCalledTimes(1);
        // ⛔ Never `warn`/`info`: the level is what makes the line survive
        // `--log-level`'s `warn` default.
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();

        const [message, error, meta] = logger.error.mock.calls[0];
        expect(String(message)).toContain('kaboom');
        expect((error as Error).stack).toBeTruthy();
        expect(meta).toMatchObject({ status: 500 });
    });

    it('carries method, path and request id when the door knows them', () => {
        const logger = spyLogger();
        logServerFault(
            {
                status: 500,
                error: new Error('driver down'),
                code: 'INTERNAL_ERROR',
                request: { method: 'GET', path: '/api/v1/packages', requestId: 'req_1' },
            },
            logger,
        );

        const [message, , meta] = logger.error.mock.calls[0];
        expect(String(message)).toBe(`${SERVER_FAULT_LOG_PREFIX} 500 GET /api/v1/packages — driver down`);
        expect(meta).toEqual({
            status: 500,
            code: 'INTERNAL_ERROR',
            method: 'GET',
            path: '/api/v1/packages',
            requestId: 'req_1',
        });
    });

    it('survives a producer that threw a non-Error, rather than losing the line', () => {
        const logger = spyLogger();
        expect(logServerFault({ status: 500, error: 'a bare string' }, logger)).toBe(true);
        expect(String(logger.error.mock.calls[0][0])).toContain('a bare string');
    });

    it('falls back to the envelope message for a declared fault that never threw', () => {
        const logger = spyLogger();
        // ⚠️ [#14656] The fixture used to be `503 SERVICE_UNAVAILABLE`, which is
        // now a declared capability ABSENCE and answers at `warn` (see the
        // describe block at the bottom of this file). The behaviour this case
        // is about — "no throw, so print the envelope's own message and invent
        // no stack" — is unchanged and belongs to the fault branch, so the
        // fixture moves to a declared fault that is not an absence.
        logServerFault({ status: 500, message: 'Package service not available', code: 'DATABASE_ERROR' }, logger);
        const [message, error] = logger.error.mock.calls[0];
        expect(String(message)).toContain('Package service not available');
        // No throw happened, so no synthetic stack is invented for one.
        expect(error).toBeUndefined();
    });

    it('never throws when the logger does — a logging failure must not become a second fault', () => {
        const logger = spyLogger();
        logger.error.mockImplementation(() => { throw new Error('sink is down'); });
        expect(() => logServerFault({ status: 500, error: new Error('x') }, logger)).not.toThrow();
    });
});

describe('serverFaultLogMessage / serverFaultLogMeta', () => {
    it('degrade to status alone when the door knows nothing else', () => {
        expect(serverFaultLogMessage({ status: 500 })).toBe(`${SERVER_FAULT_LOG_PREFIX} 500 — Unhandled server fault`);
        expect(serverFaultLogMeta({ status: 500 })).toEqual({ status: 500 });
    });
});

describe('sendError — the funnel every nested-envelope 5xx exits through', () => {
    /**
     * This is the half that makes the REST direct-mount registrars loud
     * without any per-door call: `packages/rest`'s package routes end every
     * catch in `sendError`, so wiring the rule HERE covers them (and any door
     * added later) by construction rather than by remembering.
     *
     * The sink is `console.error` because `sendError` takes no logger — it is
     * a pure envelope writer reached from ~50 sites that have no logger to
     * pass. Spying it is the only way to observe this seam, and it is done
     * ONLY here: the behavioural pins that matter (level, exact count, the
     * message and stack) assert against an INJECTED logger above and in
     * `packages/runtime/src/dispatcher-5xx-always-logged.test.ts`, where a
     * console spy would have been the weaker instrument.
     */
    const makeRes = () => {
        const res: any = {
            statusCode: undefined as number | undefined,
            body: undefined as any,
            status(c: number) { res.statusCode = c; return res; },
            json(b: any) { res.body = b; return res; },
        };
        return res;
    };

    it('logs a 5xx', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            sendError(makeRes(), 500, 'INTERNAL_ERROR', 'the driver fell over');
            const lines = spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));
            expect(lines).toHaveLength(1);
            expect(String(lines[0][0])).toContain('the driver fell over');
        } finally {
            spy.mockRestore();
        }
    });

    it('stays quiet on a 4xx — the coded refusals this door exists to carry', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            sendError(makeRes(), 409, 'DESTRUCTIVE_CHANGE', 'that change drops a column');
            sendError(makeRes(), 403, 'FORBIDDEN', 'Managing packages requires `manage_metadata`.');
            expect(spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX))).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    it('leaves the wire body byte-identical — this change adds a side effect, not a field', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            const res = makeRes();
            sendError(res, 500, 'INTERNAL_ERROR', 'boom', { details: { a: 1 } });
            expect(res.statusCode).toBe(500);
            expect(res.body).toEqual({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'boom', details: { a: 1 } },
            });
        } finally {
            spy.mockRestore();
        }
    });
});

describe('describeFaultRequest', () => {
    it('reads the spellings adapters actually use', () => {
        expect(describeFaultRequest({ method: 'GET', path: '/a', requestId: 'r1' }))
            .toEqual({ method: 'GET', path: '/a', requestId: 'r1' });
        // `url` and `originalUrl` are the other two spellings in the wild.
        expect(describeFaultRequest({ method: 'POST', url: '/b' })).toEqual({ method: 'POST', path: '/b' });
        expect(describeFaultRequest({ originalUrl: '/c' })).toEqual({ path: '/c' });
        // The id may only be on the incoming header.
        expect(describeFaultRequest({ headers: { 'x-request-id': 'r2' } })).toEqual({ requestId: 'r2' });
    });

    it('answers an empty description rather than throwing on a missing request', () => {
        expect(describeFaultRequest(undefined)).toEqual({});
        expect(describeFaultRequest(null)).toEqual({});
        expect(describeFaultRequest('not an object')).toEqual({});
    });
});

/**
 * [#14656] The ruled exception, pinned on the shared funnel itself.
 *
 * Maintainer ruling 2026-09-03 (decision batch #23, verbatim 「同意」 to B + C):
 * a **declared capability absence** — a 5xx the platform chose because the
 * deployment did not install an optional service — is reported ONCE PER ROUTE
 * PER PROCESS at `warn`, naming the missing service; everything else reaching
 * this funnel keeps its per-request `error` line.
 *
 * ⚠️ Every case here uses a DISTINCT route, on purpose: the dedupe registry is
 * module state (that IS the "per process" half), so two cases sharing a route
 * would make the second one's colour depend on execution order. Vitest gives
 * each test FILE its own module registry, which is what keeps this file and
 * `packages/runtime`'s door-level suite independent of each other.
 *
 * The two-door agreement pin the ruling asks for is
 * `packages/runtime/src/declared-capability-absence-warn-once.test.ts`: it
 * needs the REAL dispatcher on one side, which cannot be reached from here.
 */
describe('#14656 — a declared capability absence is reported once per route per process', () => {
    const absence = (path: string, method = 'GET') => ({
        status: 501,
        code: 'NOT_IMPLEMENTED',
        message: "No implementation ships for the 'notification' slot — register a service under it to enable",
        request: { method, path },
    });

    it('answers at WARN, names the missing service, and says the report is once per route', () => {
        const logger = spyLogger();
        expect(logServerFault(absence('/api/v1/warn-level'), logger)).toBe(true);

        expect(logger.error, 'a configuration fact is not a fault').not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [message, meta] = logger.warn.mock.calls[0];
        // The prefix an operator greps is unchanged — this is still a 5xx.
        expect(String(message).startsWith(SERVER_FAULT_LOG_PREFIX)).toBe(true);
        // "naming the missing service" is the ruling's own requirement, and it
        // is satisfied by the message the producer already composed.
        expect(String(message)).toContain("'notification' slot");
        // …and the suppression is stated on the one line that IS printed, so
        // "seen once" cannot be misread as "happened once".
        expect(String(message)).toContain('reported once per route per process');
        // `Logger.warn` is `(message, meta)` — there is no `Error` slot, and no
        // throw to put in one.
        expect(meta).toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED', method: 'GET', path: '/api/v1/warn-level' });
        expect(logger.warn.mock.calls[0]).toHaveLength(2);
    });

    it('reports ONCE across N requests on that route, and says so in its return value', () => {
        const logger = spyLogger();
        const route = absence('/api/v1/quiet-after-one');
        const answers = [0, 1, 2, 3].map(() => logServerFault(route, logger));

        expect(answers, 'only the first occurrence emits').toEqual([true, false, false, false]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('a SECOND, DIFFERENT route still reports — the key is the route, never a global "first N"', () => {
        // The ruling names the global throttle as "the shape that hides the
        // second route", so this is the assertion that matters most here. Both
        // routes carry the SAME code and the SAME message, so nothing but the
        // route can be doing the discriminating.
        const logger = spyLogger();
        logServerFault(absence('/api/v1/first-route'), logger);
        logServerFault(absence('/api/v1/first-route'), logger);
        logServerFault(absence('/api/v1/second-route'), logger);
        logServerFault(absence('/api/v1/second-route'), logger);

        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn.mock.calls.map((c) => (c[1] as any).path))
            .toEqual(['/api/v1/first-route', '/api/v1/second-route']);
    });

    it('the METHOD is part of the route key — two verbs on one path are two routes', () => {
        const logger = spyLogger();
        logServerFault(absence('/api/v1/two-verbs', 'GET'), logger);
        logServerFault(absence('/api/v1/two-verbs', 'POST'), logger);
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('an UNDECLARED 500 on the same route stays loud, once per request', () => {
        // The control that keeps the quiet branch honest: same route, same
        // process, N requests — N `error` lines, exactly as #14310 shipped.
        const logger = spyLogger();
        const route = { method: 'GET', path: '/api/v1/still-loud' };
        for (const _ of [0, 1, 2]) logServerFault({ status: 500, error: new Error('kaboom'), request: route }, logger);

        expect(logger.error).toHaveBeenCalledTimes(3);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('a declared 5xx OUTSIDE the two-code family stays loud, once per request', () => {
        const logger = spyLogger();
        const route = { method: 'GET', path: '/api/v1/declared-but-a-fault' };
        for (const _ of [0, 1, 2]) {
            logServerFault({ status: 502, code: 'EXTERNAL_SERVICE_ERROR', message: 'upstream refused', request: route }, logger);
        }
        expect(logger.error).toHaveBeenCalledTimes(3);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('covers the 503 SERVICE_UNAVAILABLE half of the family too', () => {
        const logger = spyLogger();
        const route = { method: 'GET', path: '/api/v1/external-datasource' };
        logServerFault({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The external-datasource service is not available.', request: route }, logger);
        logServerFault({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The external-datasource service is not available.', request: route }, logger);

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('a THROW that declared 501 keeps its per-request error line — the predicate reads the ENVELOPE', () => {
        // The thrown exit hands this funnel the throw and no `code`, so there
        // is no declared envelope to recognise. Fail-LOUD is the right default
        // for the half that carries a stack.
        const logger = spyLogger();
        const thrown = Object.assign(new Error('not wired up'), { status: 501, code: 'NOT_IMPLEMENTED' });
        const route = { method: 'GET', path: '/api/v1/thrown-501' };
        logServerFault({ status: 501, error: thrown, request: route }, logger);
        logServerFault({ status: 501, error: thrown, request: route }, logger);

        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('a door that names NO route is never deduped — an un-keyed bucket is the shape that hides routes', () => {
        const logger = spyLogger();
        const noRoute = { status: 501, code: 'NOT_IMPLEMENTED', message: 'Install @objectstack/plugin-auth to enable' };
        logServerFault(noRoute, logger);
        logServerFault(noRoute, logger);
        logServerFault(noRoute, logger);

        expect(logger.warn, 'demoted to warn, but never suppressed without a route to key on').toHaveBeenCalledTimes(3);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('a 4xx carrying one of these codes is still nothing at all — the band is unchanged', () => {
        const logger = spyLogger();
        expect(logServerFault({ status: 404, code: 'NOT_IMPLEMENTED', message: 'x', request: { method: 'GET', path: '/api/v1/4xx' } }, logger)).toBe(false);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('falls back to console.WARN, not console.error, when no logger is injected', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            logServerFault(absence('/api/v1/console-fallback'));
            expect(warnSpy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX))).toHaveLength(1);
            expect(errorSpy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX))).toHaveLength(0);
        } finally {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});
