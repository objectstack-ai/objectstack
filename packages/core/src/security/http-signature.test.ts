// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { timingSafeEqual } from 'node:crypto';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
    HTTP_SIGNATURE_HEADER,
    HTTP_SIGNATURE_TOLERANCE_SECONDS,
    signHttpBody,
    signHttpBodyAt,
    verifyHttpSignature,
} from '../index.js';

// The constant-time pin below counts calls to `timingSafeEqual`; the wrapper
// keeps its behaviour byte for byte.
vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

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

/**
 * The timestamped form: the same literal-value discipline as above. Every
 * receiver of a `t=…,v1=…` value — ours and anyone else's — relies on these
 * exact bytes, and on the timestamp being inside the signed material.
 */
describe('the timestamped form of the HTTP signature scheme', () => {
    it('is t=<seconds>,v1= plus the lowercase hex HMAC-SHA256 of "<t>.<body>"', () => {
        expect(signHttpBodyAt('{"a":1}', 'shh', 1760000000)).toBe(
            't=1760000000,v1=f5f3d98fe723d34c35649871bfa9eb4530a1b2f197e96e6e8c1b95a984e3d46d',
        );
        expect(signHttpBodyAt('', 'flow-hook-secret', 0)).toBe(
            't=0,v1=6433f1bb31a3f1b7ddbc61b4e6361758e607526ac9953cb6a91389500ffefad0',
        );
    });

    it('signs the timestamp: the same body at another second is another signature', () => {
        const at = signHttpBodyAt('{"a":1}', 'shh', 1760000000).split(',v1=')[1];
        const next = signHttpBodyAt('{"a":1}', 'shh', 1760000001).split(',v1=')[1];
        expect(next).not.toBe(at);
        // And it is not the body-only HMAC with a timestamp beside it.
        expect(at).not.toBe(signHttpBody('{"a":1}', 'shh').slice('sha256='.length));
    });

    it('refuses a timestamp that is not a non-negative whole number of seconds', () => {
        for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => signHttpBodyAt('{}', 'shh', bad)).toThrow(RangeError);
        }
    });

    it('has a fixed five-minute tolerance window', () => {
        expect(HTTP_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
    });
});

describe('verifyHttpSignature — the receiver\'s half of both forms', () => {
    const NOW = 1760000000;
    const BODY = '{"event":"paid","id":"evt_1"}';
    const SECRET = 'pin-verify-secret-7c1e';

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW * 1000);
        vi.mocked(timingSafeEqual).mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('accepts a fresh timestamped value, as the v1 form', () => {
        expect(verifyHttpSignature(BODY, SECRET, signHttpBodyAt(BODY, SECRET, NOW))).toEqual({ valid: true, scheme: 'v1' });
    });

    it('accepts a timestamp at either edge of the window, and refuses one second past either edge', () => {
        const at = (t: number) => verifyHttpSignature(BODY, SECRET, signHttpBodyAt(BODY, SECRET, t));
        expect(at(NOW - HTTP_SIGNATURE_TOLERANCE_SECONDS)).toEqual({ valid: true, scheme: 'v1' });
        expect(at(NOW + HTTP_SIGNATURE_TOLERANCE_SECONDS)).toEqual({ valid: true, scheme: 'v1' });
        expect(at(NOW - HTTP_SIGNATURE_TOLERANCE_SECONDS - 1)).toEqual({ valid: false, reason: 'outside-window' });
        expect(at(NOW + HTTP_SIGNATURE_TOLERANCE_SECONDS + 1)).toEqual({ valid: false, reason: 'outside-window' });
    });

    it('refuses a value it accepted once the clock has moved past the window — a replay', () => {
        const header = signHttpBodyAt(BODY, SECRET, NOW);
        expect(verifyHttpSignature(BODY, SECRET, header)).toEqual({ valid: true, scheme: 'v1' });
        vi.setSystemTime((NOW + HTTP_SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
        expect(verifyHttpSignature(BODY, SECRET, header)).toEqual({ valid: false, reason: 'outside-window' });
    });

    it('refuses a timestamp the HMAC does not cover — never a fallback to the body-only form', () => {
        const bodyOnlyHex = signHttpBody(BODY, SECRET).slice('sha256='.length);
        // A captured body-only signature, re-labelled with a fresh timestamp,
        // in either spelling.
        expect(verifyHttpSignature(BODY, SECRET, `t=${NOW},v1=${bodyOnlyHex}`)).toEqual({ valid: false, reason: 'mismatch' });
        expect(verifyHttpSignature(BODY, SECRET, `t=${NOW},sha256=${bodyOnlyHex}`)).toEqual({ valid: false, reason: 'malformed' });
        // A genuine value whose timestamp was moved into the window.
        const stale = signHttpBodyAt(BODY, SECRET, NOW - 3600);
        const moved = stale.replace(`t=${NOW - 3600},`, `t=${NOW},`);
        expect(moved).not.toBe(stale);
        expect(verifyHttpSignature(BODY, SECRET, moved)).toEqual({ valid: false, reason: 'mismatch' });
    });

    it('refuses the wrong secret and the wrong body in the timestamped form', () => {
        expect(verifyHttpSignature(BODY, SECRET, signHttpBodyAt(BODY, 'another-secret', NOW)))
            .toEqual({ valid: false, reason: 'mismatch' });
        expect(verifyHttpSignature(`${BODY} `, SECRET, signHttpBodyAt(BODY, SECRET, NOW)))
            .toEqual({ valid: false, reason: 'mismatch' });
    });

    it('refuses every value that claims the timestamped form without its exact shape', () => {
        const hex = signHttpBodyAt(BODY, SECRET, NOW).split(',v1=')[1]!;
        for (const malformed of [
            `t=${NOW}`,
            `t=${NOW},v1=`,
            `t=${NOW},v1=${hex.slice(1)}`,
            `t=${NOW},v1=${hex.toUpperCase()}`,
            `v1=${hex},t=${NOW}`,
            `t=0${NOW},v1=${hex}`,
            `t=+${NOW},v1=${hex}`,
            `t=${NOW}.5,v1=${hex}`,
            `t=${NOW},v1=${hex},v0=${hex}`,
            `t=${NOW},v1=${hex},v1=${hex}`,
            `t = ${NOW}, v1 = ${hex}`,
            `t=${NOW},sha256=${hex}`,
            `T=${NOW},V1=${hex}`,
            'garbage',
        ]) {
            expect(verifyHttpSignature(BODY, SECRET, malformed), malformed).toEqual({ valid: false, reason: 'malformed' });
        }
    });

    it('still accepts the body-only form, as body-only, and refuses a wrong one', () => {
        expect(verifyHttpSignature(BODY, SECRET, signHttpBody(BODY, SECRET))).toEqual({ valid: true, scheme: 'body-only' });
        expect(verifyHttpSignature(BODY, SECRET, signHttpBody(BODY, 'another-secret'))).toEqual({ valid: false, reason: 'mismatch' });
        expect(verifyHttpSignature(BODY, SECRET, 'sha256=zz')).toEqual({ valid: false, reason: 'mismatch' });
        // The body-only form signs no time, so the clock never refuses it.
        vi.setSystemTime((NOW + 10 * 365 * 24 * 3600) * 1000);
        expect(verifyHttpSignature(BODY, SECRET, signHttpBody(BODY, SECRET))).toEqual({ valid: true, scheme: 'body-only' });
    });

    it('trims the header, and reads a missing or blank one as absent', () => {
        expect(verifyHttpSignature(BODY, SECRET, `  ${signHttpBodyAt(BODY, SECRET, NOW)}  `)).toEqual({ valid: true, scheme: 'v1' });
        expect(verifyHttpSignature(BODY, SECRET, ` ${signHttpBody(BODY, SECRET)}\t`)).toEqual({ valid: true, scheme: 'body-only' });
        for (const absent of [undefined, '', '   ']) {
            expect(verifyHttpSignature(BODY, SECRET, absent)).toEqual({ valid: false, reason: 'absent' });
        }
    });

    it('decides every well-formed value of either form by a constant-time comparison', () => {
        const compare = vi.mocked(timingSafeEqual);
        const cases: Array<[string, boolean]> = [
            [signHttpBodyAt(BODY, SECRET, NOW), true],
            [signHttpBodyAt(BODY, 'another-secret', NOW), false],
            [signHttpBody(BODY, SECRET), true],
            [signHttpBody(BODY, 'another-secret'), false],
        ];
        for (const [header, valid] of cases) {
            compare.mockClear();
            expect(verifyHttpSignature(BODY, SECRET, header).valid, header).toBe(valid);
            expect(compare, header).toHaveBeenCalledTimes(1);
            expect(compare.mock.results[0]!.value, header).toBe(valid);
        }
    });
});
