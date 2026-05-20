// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { NoopErrorReporter, InMemoryErrorReporter } from './error-reporter.js';

describe('NoopErrorReporter', () => {
    it('captures without throwing or recording anything', () => {
        const r = new NoopErrorReporter();
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

    it('preserves capture order', () => {
        const r = new InMemoryErrorReporter();
        r.captureException(new Error('a'));
        r.captureException(new Error('b'));
        r.captureException(new Error('c'));
        expect(r.captured.map(c => (c.error as Error).message)).toEqual(['a', 'b', 'c']);
    });

    it('reset() clears recorded errors', () => {
        const r = new InMemoryErrorReporter();
        r.captureException(new Error('x'));
        r.reset();
        expect(r.captured).toEqual([]);
    });

    it('accepts non-Error throwables (e.g. string, plain object)', () => {
        const r = new InMemoryErrorReporter();
        r.captureException('plain string');
        r.captureException({ code: 'EPIPE' });
        expect(r.captured).toHaveLength(2);
    });
});
