// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectLogger` prints an error's `cause` chain.
 *
 * `logger.error(message, err)` used to record `{ message, stack }` of the
 * error alone, so a wrapper thrown with the original on `cause` logged
 * without its root cause — the 5xx fault line (`logServerFault`,
 * `@objectstack/types`) hands its injected logger exactly such a wrapper.
 * The record now carries `error.causes`, bounded, in the same shape the fault
 * log's console fallback prints; the parity block below pins the two copies
 * to one output.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { faultCauseChain } from '@objectstack/types';

import { createLogger } from './logger.js';

const ROOT = 'SQLITE_IOERR: disk I/O error reading policy_revision.version';
const MID = 'driver read failed for policy_revision';
const OUTER = 'The related records of policy could not be read.';

const wrapped = () => new Error(OUTER, { cause: new Error(MID, { cause: new Error(ROOT) }) });

type ErrorRecord = { error?: { message: string; stack?: string; causes?: Array<{ message: string; stack?: string }> } };

/** One `error`-level record as the JSON format writes it to stderr. */
function recordOf(log: (logger: ReturnType<typeof createLogger>) => void): ErrorRecord {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    }) as never);
    log(createLogger({ format: 'json', level: 'debug' }));
    const lines = chunks.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]) as ErrorRecord;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ObjectLogger — an error record carries the cause chain', () => {
    it('logs each cause\'s message and stack, outermost first', () => {
        const record = recordOf((logger) => logger.error('[5xx] 500 GET /api/v1/x — boom', wrapped(), { status: 500 }));
        expect(record.error?.message).toBe(OUTER);
        expect(record.error?.stack).toContain(OUTER);
        const causes = record.error?.causes ?? [];
        expect(causes).toHaveLength(2);
        expect(causes[0].message).toBe(`Error: ${MID}`);
        expect(causes[0].stack).toContain(MID);
        expect(causes[1].message).toBe(`Error: ${ROOT}`);
        expect(causes[1].stack).toContain(ROOT);
    });

    it('fatal renders it too', () => {
        const record = recordOf((logger) => logger.fatal('down', wrapped()));
        expect(record.error?.causes?.[1].message).toBe(`Error: ${ROOT}`);
    });

    it('CONTROL — an error with no cause carries no causes field', () => {
        const record = recordOf((logger) => logger.error('plain', new Error(OUTER)));
        expect(record.error).toBeDefined();
        expect(record.error).not.toHaveProperty('causes');
    });

    it('stops a cycle at its first repeat, and says so', () => {
        const a = new Error('a');
        const b = new Error('b', { cause: a });
        (a as { cause?: unknown }).cause = b;
        const record = recordOf((logger) => logger.error('cycle', a));
        expect(record.error?.causes?.map((c) => c.message)).toEqual([
            'Error: b',
            '[cause chain cycle: this link repeats an earlier one]',
        ]);
    });

    it('stops a deep chain after five links, and says so', () => {
        let error = new Error('link 0');
        for (let i = 1; i <= 20; i += 1) error = new Error(`link ${i}`, { cause: error });
        const causes = recordOf((logger) => logger.error('deep', error)).error?.causes ?? [];
        expect(causes).toHaveLength(6);
        expect(causes[5]).toEqual({ message: '[cause chain truncated after 5 links]' });
    });
});

describe('a cause is redacted like the error', () => {
    it('under the logger\'s own redact list', () => {
        const chunks: string[] = [];
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
            chunks.push(String(chunk));
            return true;
        }) as never);
        const logger = createLogger({ format: 'json', level: 'debug', redact: ['password', 'apiKey', 'pin'] });
        logger.error('withheld', new Error('w', { cause: { code: 'ECONNRESET', password: 'hunter2', apiKey: 'sk-live-1', pin: '0000' } }));
        const line = chunks.join('');
        for (const value of ['hunter2', 'sk-live-1', '0000']) expect(line).not.toContain(value);
        const record = JSON.parse(line.trim()) as ErrorRecord;
        expect(JSON.parse(record.error?.causes?.[0].message ?? '')).toEqual({
            code: 'ECONNRESET',
            password: '***REDACTED***',
            apiKey: '***REDACTED***',
            pin: '***REDACTED***',
        });
    });

    it('a link whose message read throws ends the chain in a marker, and the record is still written', () => {
        const unreadable = new Error('unreadable');
        Object.defineProperty(unreadable, 'message', { get() { throw new Error('getter'); } });
        const record = recordOf((logger) => logger.error('unreadable', new Error('w', { cause: unreadable })));
        expect(record.error?.causes).toEqual([{ message: '[cause chain link unreadable: reading it threw]' }]);
    });
});

describe('parity — the logger and the fault log render one shape', () => {
    const cycle = () => {
        const a = new Error('a');
        (a as { cause?: unknown }).cause = new Error('b', { cause: a });
        return a;
    };
    const deep = () => {
        let error = new Error('link 0');
        for (let i = 1; i <= 9; i += 1) error = new Error(`link ${i}`, { cause: error });
        return error;
    };
    const fixtures: Array<[string, () => Error]> = [
        ['a nested Error chain', wrapped],
        ['a cycle', cycle],
        ['a deep chain', deep],
        ['a string cause', () => new Error('w', { cause: 'socket hang up' })],
        ['an object cause', () => new Error('w', { cause: { code: 'ECONNRESET' } })],
        ['a cause redacted like the error', () => new Error('w', { cause: { code: 'E1', password: 'p', apiKey: 'k' } })],
        ['an object cause that cannot be serialized', () => {
            const loop: Record<string, unknown> = { code: 'E2' };
            loop.self = loop;
            return new Error('w', { cause: loop });
        }],
        ['a link whose message read throws', () => {
            const unreadable = new Error('unreadable');
            Object.defineProperty(unreadable, 'message', { get() { throw new Error('getter'); } });
            return new Error('w', { cause: new Error('mid', { cause: unreadable }) });
        }],
        ['a throwing cause getter', () => {
            const hostile = new Error('w');
            Object.defineProperty(hostile, 'cause', { get() { throw new Error('getter'); } });
            return hostile;
        }],
    ];
    it.each(fixtures)('%s', (_name, make) => {
        const error = make();
        const record = recordOf((logger) => logger.error('parity', error));
        // The record omits `causes` when the chain is empty; the fault log's helper answers `[]`.
        expect(record.error?.causes ?? []).toEqual(faultCauseChain(error));
    });
});
