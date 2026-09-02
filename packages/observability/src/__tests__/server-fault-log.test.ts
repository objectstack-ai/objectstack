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
} from '../server-fault-log.js';

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
        logServerFault({ status: 503, message: 'Package service not available', code: 'SERVICE_UNAVAILABLE' }, logger);
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
