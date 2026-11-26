// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 5xx fault line prints the thrown value's `cause` chain.
 *
 * A producer that wraps an original on `cause` hands the door its own
 * sentence; the original is the operator's. The line used to print the
 * wrapper alone, so a wrapped fault logged without its root cause. These pin
 * the console fallback (the sink `sendError` / `sendServerFault` and an
 * un-wired door reach), the bounds (a cycle, a deep chain), the hand-off to an
 * injected logger (which renders the chain itself, so the line never carries
 * it twice), and the wire (which carries none of it).
 */

import { describe, it, expect, vi } from 'vitest';

import { logServerFault, faultCauseChain, FAULT_CAUSE_DEPTH_LIMIT, SERVER_FAULT_LOG_PREFIX } from './server-fault-log.js';
import { sendServerFault } from './response-envelope.js';

/** `new Error(message, { cause })` without the ES2022 lib this package does not compile against. */
const withCause = (message: string, cause: unknown): Error => Object.assign(new Error(message), { cause });

const ROOT = 'SQLITE_IOERR: disk I/O error reading policy_revision.version';
const MID = 'driver read failed for policy_revision';
const OUTER = 'The related records of policy could not be read.';

/** wrapper → mid → root, the shape a door wraps a driver error in. */
const wrapped = () => withCause(OUTER, withCause(MID, new Error(ROOT)));

const faultLines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => String(c[0]).startsWith(SERVER_FAULT_LOG_PREFIX));

describe('logServerFault — the console fallback prints the cause chain', () => {
    it('logs each cause\'s message and stack, outermost first', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            logServerFault({ status: 500, code: 'INTERNAL_ERROR', error: wrapped() });
            const lines = faultLines(spy);
            expect(lines).toHaveLength(1);
            const meta = lines[0][1] as { stack?: string; causes?: Array<{ message: string; stack?: string }> };
            expect(meta.stack).toContain(OUTER);
            expect(meta.causes).toHaveLength(2);
            expect(meta.causes?.[0].message).toBe(`Error: ${MID}`);
            expect(meta.causes?.[0].stack).toContain(MID);
            expect(meta.causes?.[1].message).toBe(`Error: ${ROOT}`);
            expect(meta.causes?.[1].stack).toContain(ROOT);
        } finally {
            spy.mockRestore();
        }
    });

    it('CONTROL — an error with no cause carries no causes field', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            logServerFault({ status: 500, error: new Error(OUTER) });
            const meta = faultLines(spy)[0][1] as Record<string, unknown>;
            expect(meta).not.toHaveProperty('causes');
        } finally {
            spy.mockRestore();
        }
    });

    it('a declared capability absence (warn, no throw) carries none either', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            logServerFault({
                status: 501,
                code: 'NOT_IMPLEMENTED',
                error: wrapped(),
                request: { method: 'GET', path: '/api/v1/cause-chain-absence-probe' },
            });
            const meta = spy.mock.calls[0][1] as Record<string, unknown>;
            expect(meta).not.toHaveProperty('causes');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('faultCauseChain — bounded both ways', () => {
    it('stops a cycle at its first repeat, and says so', () => {
        const a = new Error('a');
        const b = withCause('b', a);
        (a as { cause?: unknown }).cause = b;
        const chain = faultCauseChain(a);
        expect(chain.map((l) => l.message)).toEqual([
            'Error: b',
            '[cause chain cycle: this link repeats an earlier one]',
        ]);
    });

    it('stops a self-cause at once', () => {
        const self = new Error('self');
        (self as { cause?: unknown }).cause = self;
        expect(faultCauseChain(self)).toEqual([{ message: '[cause chain cycle: this link repeats an earlier one]' }]);
    });

    it(`stops a deep chain after ${FAULT_CAUSE_DEPTH_LIMIT} links, and says so`, () => {
        let error = new Error('link 0');
        for (let i = 1; i <= 20; i += 1) error = withCause(`link ${i}`, error);
        const chain = faultCauseChain(error);
        expect(chain).toHaveLength(FAULT_CAUSE_DEPTH_LIMIT + 1);
        expect(chain.slice(0, FAULT_CAUSE_DEPTH_LIMIT).map((l) => l.message)).toEqual(
            ['link 19', 'link 18', 'link 17', 'link 16', 'link 15'].map((m) => `Error: ${m}`),
        );
        expect(chain[FAULT_CAUSE_DEPTH_LIMIT]).toEqual({ message: `[cause chain truncated after ${FAULT_CAUSE_DEPTH_LIMIT} links]` });
    });

    it('prints a non-Error cause as its text, and ends the chain there', () => {
        expect(faultCauseChain(withCause('w', 'socket hang up'))).toEqual([{ message: 'socket hang up' }]);
        expect(faultCauseChain(withCause('w', { code: 'ECONNRESET' }))).toEqual([{ message: '{"code":"ECONNRESET"}' }]);
    });

    it('a throwing cause getter ends the chain rather than costing the line', () => {
        const hostile = new Error('w');
        Object.defineProperty(hostile, 'cause', { get() { throw new Error('getter'); } });
        expect(faultCauseChain(hostile)).toEqual([]);
        expect(faultCauseChain('a string throw')).toEqual([]);
        expect(faultCauseChain(undefined)).toEqual([]);
    });

    it('a link whose message read throws ends the chain in a marker, and the line is still written', () => {
        const unreadable = new Error('unreadable');
        Object.defineProperty(unreadable, 'message', { get() { throw new Error('getter'); } });
        const outer = withCause(OUTER, withCause(MID, unreadable));
        expect(faultCauseChain(outer)).toEqual([
            expect.objectContaining({ message: `Error: ${MID}` }),
            { message: '[cause chain link unreadable: reading it threw]' },
        ]);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(logServerFault({ status: 500, error: outer })).toBe(true);
            const meta = faultLines(spy)[0][1] as { causes?: Array<{ message: string }> };
            expect(meta.causes?.[1]).toEqual({ message: '[cause chain link unreadable: reading it threw]' });
        } finally {
            spy.mockRestore();
        }
    });
});

describe('a cause is redacted like the error', () => {
    it('an object cause', () => {
        const chain = faultCauseChain(withCause('w', { code: 'ECONNRESET', password: 'hunter2', apiKey: 'sk-live-1', nested: { authToken: 't-1' } }));
        expect(chain).toHaveLength(1);
        expect(JSON.parse(chain[0].message)).toEqual({
            code: 'ECONNRESET',
            password: '***REDACTED***',
            apiKey: '***REDACTED***',
            nested: { authToken: '***REDACTED***' },
        });
        for (const value of ['hunter2', 'sk-live-1', 't-1']) expect(chain[0].message).not.toContain(value);
    });

    it('by whole words, as the logger matches its redact list', () => {
        const [line] = faultCauseChain(withCause('w', {
            keys: ['a'], tokens: 3, monkey: 'm', keyword: 'k', secretary: 's',
            apiKey: 'x', apikey: 'x', refresh_tokens: ['x'], password: 'x',
        }));
        expect(JSON.parse(line.message)).toEqual({
            keys: ['a'], tokens: 3, monkey: 'm', keyword: 'k', secretary: 's',
            apiKey: '***REDACTED***', apikey: '***REDACTED***', refresh_tokens: '***REDACTED***', password: '***REDACTED***',
        });
    });

    it('inside an array in an object cause', () => {
        const [line] = faultCauseChain(withCause('w', { attempts: [{ host: 'db-1', password: 'x' }, { host: 'db-2' }] }));
        expect(JSON.parse(line.message)).toEqual({ attempts: [{ host: 'db-1', password: '***REDACTED***' }, { host: 'db-2' }] });
    });

    it('on the console fallback line', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            logServerFault({ status: 500, error: withCause(OUTER, { password: 'hunter2' }) });
            const meta = faultLines(spy)[0][1] as { causes?: Array<{ message: string }> };
            expect(meta.causes).toEqual([{ message: '{"password":"***REDACTED***"}' }]);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('logServerFault — an injected logger renders the chain itself', () => {
    it('hands the logger the thrown error with its cause intact, and no second copy in meta', () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
        const thrown = wrapped();
        logServerFault({ status: 500, error: thrown }, logger as never);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [, err, meta] = logger.error.mock.calls[0];
        expect(err).toBe(thrown);
        expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
        expect(meta).not.toHaveProperty('causes');
    });
});

describe('the wire carries no cause text', () => {
    it('sendServerFault answers the generic envelope while the line carries the root cause', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const res: any = {
                statusCode: undefined as number | undefined,
                body: undefined as unknown,
                status(c: number) { res.statusCode = c; return res; },
                json(b: unknown) { res.body = b; return res; },
            };
            sendServerFault(res, 500, 'INTERNAL_ERROR', 'Internal server error', wrapped());
            expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
            for (const word of [ROOT, MID, OUTER, 'causes', 'SQLITE']) expect(JSON.stringify(res.body)).not.toContain(word);
            const meta = faultLines(spy)[0][1] as { causes?: Array<{ message: string }> };
            expect(meta.causes?.[1].message).toBe(`Error: ${ROOT}`);
        } finally {
            spy.mockRestore();
        }
    });
});
