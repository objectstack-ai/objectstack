// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    extractRequestId,
    generateRequestId,
    resolveRequestId,
    parseTraceparent,
    formatTraceparent,
} from './request-context.js';

describe('extractRequestId', () => {
    it('returns id when header is present and well-formed', () => {
        expect(extractRequestId({ 'x-request-id': 'abc-123' })).toBe('abc-123');
    });

    it('lookup is case-insensitive', () => {
        expect(extractRequestId({ 'X-Request-Id': 'abc-123' })).toBe('abc-123');
        expect(extractRequestId({ 'X-REQUEST-ID': 'abc-123' })).toBe('abc-123');
    });

    it('trims surrounding whitespace', () => {
        expect(extractRequestId({ 'x-request-id': '  abc-123  ' })).toBe('abc-123');
    });

    it('accepts the alphanumeric . _ - : alphabet', () => {
        expect(extractRequestId({ 'x-request-id': 'req_A.B-C:1.2.3' })).toBe('req_A.B-C:1.2.3');
    });

    it('takes the first value when the header arrives as an array', () => {
        expect(extractRequestId({ 'x-request-id': ['first', 'second'] })).toBe('first');
    });

    it('rejects malformed input', () => {
        // empty
        expect(extractRequestId({ 'x-request-id': '' })).toBeUndefined();
        // whitespace only
        expect(extractRequestId({ 'x-request-id': '   ' })).toBeUndefined();
        // contains whitespace
        expect(extractRequestId({ 'x-request-id': 'has space' })).toBeUndefined();
        // contains forbidden chars (newline injection attempt)
        expect(extractRequestId({ 'x-request-id': 'evil\r\nset-cookie: x=y' })).toBeUndefined();
        // non-string
        expect(extractRequestId({ 'x-request-id': 42 })).toBeUndefined();
    });

    it('rejects pathologically long ids', () => {
        const huge = 'a'.repeat(1024);
        expect(extractRequestId({ 'x-request-id': huge })).toBeUndefined();
    });

    it('returns undefined when header is absent or invalid container', () => {
        expect(extractRequestId({})).toBeUndefined();
        expect(extractRequestId(null)).toBeUndefined();
        expect(extractRequestId(undefined)).toBeUndefined();
        expect(extractRequestId('not an object')).toBeUndefined();
    });
});

describe('generateRequestId', () => {
    it('produces a string with the req_ prefix', () => {
        const id = generateRequestId();
        expect(id).toMatch(/^req_[A-Za-z0-9]+$/);
    });

    it('produces unique ids', () => {
        const a = generateRequestId();
        const b = generateRequestId();
        expect(a).not.toBe(b);
    });
});

describe('resolveRequestId', () => {
    it('echoes a valid incoming id', () => {
        expect(resolveRequestId({ 'x-request-id': 'caller-123' })).toBe('caller-123');
    });

    it('mints a fresh id when none present', () => {
        const id = resolveRequestId({});
        expect(id).toMatch(/^req_/);
    });

    it('mints a fresh id when incoming is malformed (so attackers cannot suppress logging)', () => {
        const id = resolveRequestId({ 'x-request-id': 'has space' });
        expect(id).toMatch(/^req_/);
    });

    it('accepts a custom generator (for test determinism)', () => {
        expect(resolveRequestId({}, () => 'fixed')).toBe('fixed');
    });
});

describe('parseTraceparent', () => {
    it('parses a valid sampled traceparent', () => {
        const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
        expect(parseTraceparent(tp)).toEqual({
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: 'b7ad6b7169203331',
            sampled: true,
        });
    });

    it('parses unsampled flag', () => {
        const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00';
        expect(parseTraceparent(tp)?.sampled).toBe(false);
    });

    it('normalizes uppercase hex', () => {
        const tp = '00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01';
        expect(parseTraceparent(tp)?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('rejects malformed values', () => {
        expect(parseTraceparent('garbage')).toBeUndefined();
        expect(parseTraceparent('')).toBeUndefined();
        expect(parseTraceparent(undefined)).toBeUndefined();
        // wrong length trace id
        expect(parseTraceparent('00-short-b7ad6b7169203331-01')).toBeUndefined();
    });

    it('rejects unknown versions (forward-compat opt-in)', () => {
        const tp = 'ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
        expect(parseTraceparent(tp)).toBeUndefined();
    });

    it('rejects the all-zero invalid trace/span id', () => {
        expect(
            parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01'),
        ).toBeUndefined();
        expect(
            parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01'),
        ).toBeUndefined();
    });
});

describe('formatTraceparent', () => {
    it('round-trips through parseTraceparent', () => {
        const ctx = {
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: 'b7ad6b7169203331',
            sampled: true,
        };
        expect(parseTraceparent(formatTraceparent(ctx))).toEqual(ctx);
    });
});
