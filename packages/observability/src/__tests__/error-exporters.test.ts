// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { ErrorReporter } from '../contracts.js';
import {
    NoopErrorReporter,
    InMemoryErrorReporter,
    ConsoleErrorReporter,
} from '../error-exporters.js';

describe('NoopErrorReporter', () => {
    it('captures without throwing or recording anything', () => {
        const r: ErrorReporter = new NoopErrorReporter();
        expect(() => r.captureException(new Error('boom'), { x: 1 })).not.toThrow();
    });
});

describe('InMemoryErrorReporter', () => {
    it('records captured errors with context', () => {
        const r = new InMemoryErrorReporter();
        const err = new Error('boom');
        r.captureException(err, { requestId: 'abc', route: '/api' });
        expect(r.captured).toHaveLength(1);
        expect(r.captured[0].error).toBe(err);
        expect(r.captured[0].context).toEqual({ requestId: 'abc', route: '/api' });
    });

    it('records context as empty object when omitted', () => {
        const r = new InMemoryErrorReporter();
        r.captureException(new Error('x'));
        expect(r.captured[0].context).toEqual({});
    });

    it('reset() clears recorded errors', () => {
        const r = new InMemoryErrorReporter();
        r.captureException(new Error('x'));
        r.reset();
        expect(r.captured).toHaveLength(0);
    });
});

describe('ConsoleErrorReporter', () => {
    it('writes structured JSON for Error instances including stack', () => {
        const lines: string[] = [];
        const r = new ConsoleErrorReporter({ sink: (s) => lines.push(s) });
        r.captureException(new Error('boom'), { requestId: 'r1' });
        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]);
        expect(record.level).toBe('error');
        expect(record.msg).toBe('boom');
        expect(record.context).toEqual({ requestId: 'r1' });
        expect(typeof record.stack).toBe('string');
        expect(typeof record.ts).toBe('string');
    });

    it('serialises non-Error values via String()', () => {
        const lines: string[] = [];
        const r = new ConsoleErrorReporter({ sink: (s) => lines.push(s) });
        r.captureException({ weird: 'thing' });
        const record = JSON.parse(lines[0]);
        expect(record.msg).toBe('[object Object]');
        expect(record.stack).toBeUndefined();
    });

    it('never throws when the sink throws', () => {
        const r = new ConsoleErrorReporter({ sink: () => { throw new Error('sink broken'); } });
        expect(() => r.captureException(new Error('x'))).not.toThrow();
    });
});
