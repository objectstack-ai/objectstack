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

const ROOT = 'SQLITE_IOERR: disk I/O error reading policy_revision.version';
const MID = 'driver read failed for policy_revision';
const OUTER = 'The related records of policy could not be read.';

/** wrapper → mid → root, the shape a door wraps a driver error in. */
const wrapped = () => new Error(OUTER, { cause: new Error(MID, { cause: new Error(ROOT) }) });

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
        const b = new Error('b', { cause: a });
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
        for (let i = 1; i <= 20; i += 1) error = new Error(`link ${i}`, { cause: error });
        const chain = faultCauseChain(error);
        expect(chain).toHaveLength(FAULT_CAUSE_DEPTH_LIMIT + 1);
        expect(chain.slice(0, FAULT_CAUSE_DEPTH_LIMIT).map((l) => l.message)).toEqual(
            ['link 19', 'link 18', 'link 17', 'link 16', 'link 15'].map((m) => `Error: ${m}`),
        );
        expect(chain[FAULT_CAUSE_DEPTH_LIMIT]).toEqual({ message: `[cause chain truncated after ${FAULT_CAUSE_DEPTH_LIMIT} links]` });
    });

    it('prints a non-Error cause as its text, and ends the chain there', () => {
        expect(faultCauseChain(new Error('w', { cause: 'socket hang up' }))).toEqual([{ message: 'socket hang up' }]);
        expect(faultCauseChain(new Error('w', { cause: { code: 'ECONNRESET' } }))).toEqual([{ message: '{"code":"ECONNRESET"}' }]);
    });

    it('a throwing cause getter ends the chain rather than costing the line', () => {
        const hostile = new Error('w');
        Object.defineProperty(hostile, 'cause', { get() { throw new Error('getter'); } });
        expect(faultCauseChain(hostile)).toEqual([]);
        expect(faultCauseChain('a string throw')).toEqual([]);
        expect(faultCauseChain(undefined)).toEqual([]);
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
        expect((err as Error).cause).toBeInstanceOf(Error);
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
