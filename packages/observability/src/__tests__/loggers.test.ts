// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { faultCauseChain, FAULT_CAUSE_DEPTH_LIMIT } from '@objectstack/types';
import type { Logger } from '../contracts.js';
import { NoopLogger, ConsoleLogger, JsonLogger } from '../loggers.js';

function makeSink() {
    const log: string[] = [];
    const error: string[] = [];
    return {
        sink: { log: (s: string) => log.push(s), error: (s: string) => error.push(s) },
        log,
        error,
    };
}

describe('NoopLogger', () => {
    it('discards every call', () => {
        const l: Logger = new NoopLogger();
        expect(() => {
            l.debug('x');
            l.info('x');
            l.warn('x');
            l.error('x', new Error('e'));
            l.fatal?.('x', new Error('e'));
        }).not.toThrow();
    });

    it('child() returns a logger that also discards', () => {
        const l: Logger = new NoopLogger();
        const c = l.child?.({ foo: 'bar' });
        expect(c).toBeDefined();
        expect(() => c?.info('hi')).not.toThrow();
    });
});

describe('ConsoleLogger', () => {
    it('respects the level threshold', () => {
        const { sink, log, error } = makeSink();
        const l = new ConsoleLogger({ level: 'warn', sink });
        l.debug('d');
        l.info('i');
        l.warn('w');
        l.error('e', new Error('boom'));
        expect(log).toEqual(['[warn] w']);
        expect(error).toHaveLength(1);
        expect(error[0]).toContain('[error] e');
        expect(error[0]).toContain('"error":"boom"');
    });

    it('child() merges accumulated context into every record', () => {
        const { sink, log } = makeSink();
        const root = new ConsoleLogger({ level: 'info', sink, context: { service: 'a' } });
        const child = root.child!({ tenant: 't1' });
        child.info('hi', { route: '/x' });
        expect(log[0]).toContain('"service":"a"');
        expect(log[0]).toContain('"tenant":"t1"');
        expect(log[0]).toContain('"route":"/x"');
    });

    it('never throws when the sink throws', () => {
        const l = new ConsoleLogger({
            level: 'debug',
            sink: { log: () => { throw new Error('x'); }, error: () => { throw new Error('x'); } },
        });
        expect(() => l.info('hi')).not.toThrow();
    });
});

describe('JsonLogger', () => {
    it('emits a JSON object per line with ts, level, msg', () => {
        const { sink, log } = makeSink();
        const fixedTs = new Date('2026-01-01T00:00:00.000Z');
        const l = new JsonLogger({ level: 'info', sink, now: () => fixedTs });
        l.info('hello', { foo: 'bar' });
        expect(log).toHaveLength(1);
        const rec = JSON.parse(log[0]);
        expect(rec).toEqual({ ts: '2026-01-01T00:00:00.000Z', level: 'info', msg: 'hello', foo: 'bar' });
    });

    it('routes error/fatal to stderr and includes Error fields', () => {
        const { sink, log, error } = makeSink();
        const l = new JsonLogger({ level: 'debug', sink });
        l.error('boom', new Error('detail'), { route: '/x' });
        expect(log).toHaveLength(0);
        const rec = JSON.parse(error[0]);
        expect(rec.level).toBe('error');
        expect(rec.msg).toBe('boom');
        expect(rec.error).toBe('detail');
        expect(rec.stack).toBeTruthy();
        expect(rec.route).toBe('/x');
    });

    it('merges base fields and child context into every record', () => {
        const { sink, log } = makeSink();
        const root = new JsonLogger({ sink, base: { service: 'cloud', env: 'prod' } });
        const child = root.child!({ requestId: 'r1' });
        child.info('done');
        const rec = JSON.parse(log[0]);
        expect(rec.service).toBe('cloud');
        expect(rec.env).toBe('prod');
        expect(rec.requestId).toBe('r1');
    });

    it('threshold filters out lower-severity messages', () => {
        const { sink, log, error } = makeSink();
        const l = new JsonLogger({ level: 'error', sink });
        l.info('skip');
        l.warn('skip');
        l.error('keep');
        expect(log).toHaveLength(0);
        expect(error).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// An error record carries the error's `cause` chain, in the shape the 5xx fault
// line (`faultCauseChain`, `@objectstack/types`) and `ObjectLogger` record. The
// loggers keep their own copy (this package depends on `@objectstack/spec`
// alone); the parity block pins it to `faultCauseChain`'s output.
// ---------------------------------------------------------------------------

/** `new Error(message, { cause })`, spelled for the ES2020 `lib` this package compiles under. */
const withCause = (message: string, cause: unknown): Error => Object.assign(new Error(message), { cause });

type CauseLine = { message: string; stack?: string };
type ErrorRecord = { error?: string; stack?: string; causes?: CauseLine[] };

const ROOT = 'SQLITE_IOERR: disk I/O error reading policy_revision.version';
const MID = 'driver read failed for policy_revision';
const OUTER = 'The related records of policy could not be read.';

const wrapped = () => withCause(OUTER, withCause(MID, new Error(ROOT)));

/** The JSON tail of a `ConsoleLogger` line: `[error] msg {...}`. */
function consoleRecord(line: string, msg: string): ErrorRecord {
    const prefix = `[error] ${msg} `;
    expect(line.startsWith(prefix)).toBe(true);
    return JSON.parse(line.slice(prefix.length)) as ErrorRecord;
}

/** One error record from each logger, for the same call. */
const LOGGERS: Array<[string, (error: Error) => ErrorRecord]> = [
    ['ConsoleLogger', (error) => {
        const { sink, error: lines } = makeSink();
        new ConsoleLogger({ level: 'debug', sink }).error('boom', error);
        expect(lines).toHaveLength(1);
        return consoleRecord(lines[0], 'boom');
    }],
    ['JsonLogger', (error) => {
        const { sink, error: lines } = makeSink();
        new JsonLogger({ level: 'debug', sink }).error('boom', error);
        expect(lines).toHaveLength(1);
        return JSON.parse(lines[0]) as ErrorRecord;
    }],
];

describe.each(LOGGERS)('%s — an error record carries the cause chain', (_name, recordOf) => {
    it('logs each cause\'s message and stack, outermost first', () => {
        const record = recordOf(wrapped());
        expect(record.error).toBe(OUTER);
        expect(record.stack).toContain(OUTER);
        const causes = record.causes ?? [];
        expect(causes).toHaveLength(2);
        expect(causes[0].message).toBe(`Error: ${MID}`);
        expect(causes[0].stack).toContain(MID);
        expect(causes[1].message).toBe(`Error: ${ROOT}`);
        expect(causes[1].stack).toContain(ROOT);
    });

    it('CONTROL — an error with no cause carries no causes field', () => {
        const record = recordOf(new Error(OUTER));
        expect(record.error).toBe(OUTER);
        expect(record).not.toHaveProperty('causes');
    });

    it('stops a cycle at its first repeat, and says so', () => {
        const a = new Error('a');
        const b = withCause('b', a);
        (a as { cause?: unknown }).cause = b;
        expect(recordOf(a).causes?.map((c) => c.message)).toEqual([
            'Error: b',
            '[cause chain cycle: this link repeats an earlier one]',
        ]);
    });

    it(`stops a deep chain after ${FAULT_CAUSE_DEPTH_LIMIT} links, and says so`, () => {
        let error = new Error('link 0');
        for (let i = 1; i <= 20; i += 1) error = withCause(`link ${i}`, error);
        const causes = recordOf(error).causes ?? [];
        expect(causes).toHaveLength(FAULT_CAUSE_DEPTH_LIMIT + 1);
        expect(causes[FAULT_CAUSE_DEPTH_LIMIT]).toEqual({
            message: `[cause chain truncated after ${FAULT_CAUSE_DEPTH_LIMIT} links]`,
        });
    });
});

describe('fatal carries the cause chain too', () => {
    it('ConsoleLogger', () => {
        const { sink, error } = makeSink();
        new ConsoleLogger({ level: 'debug', sink }).fatal('down', wrapped());
        const record = JSON.parse(error[0].slice('[fatal] down '.length)) as ErrorRecord;
        expect(record.causes?.[1].message).toBe(`Error: ${ROOT}`);
    });

    it('JsonLogger', () => {
        const { sink, error } = makeSink();
        new JsonLogger({ level: 'debug', sink }).fatal('down', wrapped());
        expect((JSON.parse(error[0]) as ErrorRecord).causes?.[1].message).toBe(`Error: ${ROOT}`);
    });
});

/** The redact qualifiers a glued field name may start with, each glued to a default word. */
const GLUED_QUALIFIERS = [
    'access', 'account', 'admin', 'api', 'app', 'auth', 'bearer', 'client', 'csrf', 'db', 'database',
    'encryption', 'id', 'jwt', 'master', 'oauth', 'private', 'public', 'refresh', 'root', 'secret',
    'service', 'session', 'shared', 'sign', 'signing', 'ssh', 'token', 'user', 'webhook', 'xsrf',
];
const gluedQualifierCause = () => Object.fromEntries(GLUED_QUALIFIERS.map((qualifier) => [`${qualifier}key`, 'x']));

describe('the glued-qualifier fixture', () => {
    it('CONTROL — faultCauseChain withholds it field by field, so it exercises each qualifier', () => {
        const [line] = faultCauseChain(withCause('w', gluedQualifierCause()));
        const parsed = JSON.parse(line.message) as Record<string, string>;
        expect(Object.keys(parsed)).toHaveLength(GLUED_QUALIFIERS.length);
        expect(Object.values(parsed).every((value) => value === '***REDACTED***')).toBe(true);
    });
});

describe.each(LOGGERS)('parity — %s and faultCauseChain render one shape', (_name, recordOf) => {
    const cycle = () => {
        const a = new Error('a');
        (a as { cause?: unknown }).cause = withCause('b', a);
        return a;
    };
    const deep = () => {
        let error = new Error('link 0');
        for (let i = 1; i <= 9; i += 1) error = withCause(`link ${i}`, error);
        return error;
    };
    const fixtures: Array<[string, () => Error]> = [
        ['a nested Error chain', wrapped],
        ['a cycle', cycle],
        ['a deep chain', deep],
        ['a string cause', () => withCause('w', 'socket hang up')],
        ['an object cause', () => withCause('w', { code: 'ECONNRESET' })],
        ['an object cause with secret-named fields', () => withCause('w', { code: 'E1', password: 'p', apiKey: 'k' })],
        ['field names under the default redact words, whole-word matched', () => withCause('w', {
            keys: ['a'], tokens: 3, monkey: 'm', keyword: 'k', secretary: 's', tokenizer: 't',
            apiKey: 'x', apikey: 'x', accesstoken: 'x', refresh_tokens: ['x'], clientSecret: 'x', password: 'x', API_KEY: 'x',
        })],
        ['every glued qualifier on a default word', () => withCause('w', gluedQualifierCause())],
        ['an array inside an object cause', () => withCause('w', {
            code: 'E3', attempts: [{ host: 'db-1', password: 'x' }, { host: 'db-2', authToken: 'y' }],
        })],
        ['an object cause that cannot be serialized', () => {
            const loop: Record<string, unknown> = { code: 'E2' };
            loop.self = loop;
            return withCause('w', loop);
        }],
        ['a link whose message read throws', () => {
            const unreadable = new Error('unreadable');
            Object.defineProperty(unreadable, 'message', { get() { throw new Error('getter'); } });
            return withCause('w', withCause('mid', unreadable));
        }],
        ['a throwing cause getter', () => {
            const hostile = new Error('w');
            Object.defineProperty(hostile, 'cause', { get() { throw new Error('getter'); } });
            return hostile;
        }],
    ];
    it.each(fixtures)('%s', (_fixture, make) => {
        const error = make();
        // The record omits `causes` when the chain is empty; the fault log's helper answers `[]`.
        expect(recordOf(error).causes ?? []).toEqual(faultCauseChain(error));
    });
});
