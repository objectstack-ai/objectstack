// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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
