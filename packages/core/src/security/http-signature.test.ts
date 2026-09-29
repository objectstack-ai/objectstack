// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { HTTP_SIGNATURE_HEADER, signHttpBody } from '../index.js';

/**
 * The scheme's wire form, pinned by literal values rather than by recomputing
 * an HMAC here: a test that rebuilt the value with the same `createHmac` call
 * would agree with any change made to both. Every sender and every receiver of
 * `X-Objectstack-Signature` relies on exactly these bytes.
 */
describe('the outbound HTTP signature scheme', () => {
    it('is carried in X-Objectstack-Signature', () => {
        expect(HTTP_SIGNATURE_HEADER).toBe('X-Objectstack-Signature');
    });

    it('signs the empty body a bodyless request carries', () => {
        expect(signHttpBody('', 'flow-hook-secret')).toBe(
            'sha256=28c9179fd9763c0e7d41dc5241d9d77607270f8912e3b7692426f677bd5187f7',
        );
    });

    it('is sha256= plus the lowercase hex HMAC-SHA256 of the exact body bytes', () => {
        expect(signHttpBody('{"a":1}', 'shh')).toBe(
            'sha256=dfb8cf3fc9778c70386e30f5e0776d37f9ee9c8756d3cbd7df0902150644358d',
        );
        // One byte of difference in the body is a different signature — the
        // receiver verifies over what it received, so a sender must sign what
        // it sends, not an equivalent re-serialization.
        expect(signHttpBody('{"a": 1}', 'shh')).not.toBe(signHttpBody('{"a":1}', 'shh'));
    });
});
