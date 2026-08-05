// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The endpoint mapping keys in isolation (#5040 E5c / #5137).
 *
 * Two properties are load-bearing and every case here serves one of them:
 *
 *  1. **A declared mapping does exactly what the vocabulary says** — projects
 *     the declared `target` paths from the declared `source` paths, and nothing
 *     besides. The keys existed and were read by nothing before this; a
 *     half-implemented reading would be the same defect one layer down.
 *  2. **A declaration this runtime cannot serve is REFUSED, in the declared
 *     error envelope, naming the entry** — never skipped, never partially
 *     applied. `transform` is the case #5137 was filed over, but an unusable
 *     path and colliding targets are the same category and answer identically.
 *
 * And the identity property both rest on: with no declaration, the value that
 * goes in is the value that comes out, by reference. That is what made these
 * keys safe to land ahead of the #5040 E7 publish flip, and it is still what
 * keeps an endpoint declaring no mapping free of any projection cost.
 */

import { describe, it, expect } from 'vitest';
import { ApiEndpointSchema, ApiErrorSchema, envelopeViolations, type ApiEndpoint } from '@objectstack/spec/api';

import {
    applyInputMapping,
    applyOutputMapping,
    mappingDeclarationRejection,
    type EndpointMappingOutcome,
    type EndpointMappingRejection,
} from './api-mapping.js';

/** A declared endpoint in the ADR-0121 D1 shape, defaults materialized. */
function endpointWith(overrides: Record<string, unknown> = {}): ApiEndpoint {
    return ApiEndpointSchema.parse({
        name: 'showcase_inquiries',
        path: '/api/v1/apps/showcase/inquiries',
        method: 'POST',
        type: 'object_operation',
        target: 'showcase_inquiry',
        objectParams: { object: 'showcase_inquiry', operation: 'create' },
        ...overrides,
    });
}

/** The value of a successful outcome — failing the test if it was a refusal. */
function valueOf<T>(outcome: EndpointMappingOutcome<T>): T {
    if (!outcome.ok) {
        throw new Error(`expected a mapped value, got a refusal: ${JSON.stringify(outcome.rejection.body)}`);
    }
    return outcome.value;
}

/** The refusal of a failed outcome — failing the test if it succeeded. */
function rejectionOf(outcome: EndpointMappingOutcome<unknown>): EndpointMappingRejection {
    if (outcome.ok) throw new Error(`expected a refusal, got ${JSON.stringify(outcome.value)}`);
    return outcome.rejection;
}

/**
 * Every refusal is the declared envelope, carries the semantic code, and says
 * WHICH entry it is about. Asserted through the spec's own schemas rather than
 * a local restatement, exactly as `error-envelope.conformance.test.ts` does.
 */
function expectRefusal(rejection: EndpointMappingRejection, ...mustMention: string[]) {
    expect(rejection.status).toBe(501);
    const body = rejection.body as { success: boolean; error: Record<string, unknown> };
    expect(envelopeViolations(body)).toEqual([]);
    expect(body.success).toBe(false);
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.httpStatus).toBe(501);
    for (const fragment of mustMention) {
        expect(String(body.error.message) + String(body.error.hint)).toContain(fragment);
    }
    return body.error;
}

describe('no declaration is byte-for-byte passthrough', () => {
    it('returns the caller\'s own body BY REFERENCE when inputMapping is absent', () => {
        const body = { first_name: 'Ada', nested: { x: 1 } };
        const outcome = applyInputMapping(endpointWith(), body);
        // Reference identity, not deep equality: an endpoint that declares no
        // mapping must be delegated exactly as E5b delegated it.
        expect(valueOf(outcome)).toBe(body);
    });

    it('returns the success body BY REFERENCE when outputMapping is absent', () => {
        const successBody = { success: true, data: { records: [], total: 0 }, meta: undefined };
        expect(valueOf(applyOutputMapping(endpointWith(), successBody))).toBe(successBody);
    });

    it('treats an empty array as no declaration — not as "project nothing"', () => {
        const body = { keep: 'me' };
        const endpoint = endpointWith({ inputMapping: [], outputMapping: [] });
        expect(valueOf(applyInputMapping(endpoint, body))).toBe(body);
        expect(valueOf(applyOutputMapping(endpoint, body))).toBe(body);
    });

    it('passes an undefined body through untouched', () => {
        expect(valueOf(applyInputMapping(endpointWith(), undefined))).toBeUndefined();
    });
});

describe('inputMapping projects the request body onto the internal params', () => {
    it('renames a field, exactly as the vocabulary\'s own example does', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'firstName', target: 'first_name' }] });
        expect(valueOf(applyInputMapping(endpoint, { firstName: 'Ada' }))).toEqual({ first_name: 'Ada' });
    });

    it('reads and writes dot paths on both sides', () => {
        const endpoint = endpointWith({
            inputMapping: [
                { source: 'user.profile.email', target: 'contact.email' },
                { source: 'user.id', target: 'contact.owner_id' },
            ],
        });
        const mapped = valueOf(applyInputMapping(endpoint, {
            user: { id: 'usr_7', profile: { email: 'ada@example.com' } },
        }));
        expect(mapped).toEqual({ contact: { email: 'ada@example.com', owner_id: 'usr_7' } });
    });

    it('is a PROJECTION — an undeclared field does not ride along', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'keep', target: 'keep' }] });
        const mapped = valueOf(applyInputMapping(endpoint, { keep: 1, secret: 'internal', other: 2 }));
        expect(mapped).toEqual({ keep: 1 });
    });

    it('leaves a target UNSET when its source resolves to nothing', () => {
        const endpoint = endpointWith({
            inputMapping: [
                { source: 'present', target: 'a' },
                { source: 'absent', target: 'b' },
                { source: 'deep.missing.path', target: 'c' },
            ],
        });
        const mapped = valueOf(applyInputMapping(endpoint, { present: 1 })) as Record<string, unknown>;
        expect(mapped).toEqual({ a: 1 });
        // Absent, not `undefined`-valued: the key must not appear on the wire.
        expect(Object.keys(mapped)).toEqual(['a']);
    });

    it('carries a null through — null is a value, absence is not', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'a', target: 'b' }] });
        expect(valueOf(applyInputMapping(endpoint, { a: null }))).toEqual({ b: null });
    });

    it('addresses an array element by its numeric key', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'items.0.sku', target: 'sku' }] });
        expect(valueOf(applyInputMapping(endpoint, { items: [{ sku: 'A-1' }] }))).toEqual({ sku: 'A-1' });
    });

    it('never reads an inherited member', () => {
        // Own properties only: "the field is absent" and "the prototype has one
        // of that name" must not answer the same.
        const endpoint = endpointWith({ inputMapping: [{ source: 'toString', target: 'x' }] });
        expect(valueOf(applyInputMapping(endpoint, { a: 1 }))).toEqual({});
    });

    it('projects nothing out of a body that is not an object', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'a', target: 'b' }] });
        expect(valueOf(applyInputMapping(endpoint, 'a string body'))).toEqual({});
        expect(valueOf(applyInputMapping(endpoint, undefined))).toEqual({});
    });

    it('does not mutate the body it was given', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'a', target: 'nested.a' }] });
        const body = { a: 1 };
        applyInputMapping(endpoint, body);
        expect(body).toEqual({ a: 1 });
    });
});

describe('outputMapping projects the SUCCESS payload and preserves the envelope', () => {
    it('maps `data` and leaves every other member of the envelope alone', () => {
        const endpoint = endpointWith({
            outputMapping: [
                { source: 'total', target: 'count' },
                { source: 'records.0.name', target: 'first' },
            ],
        });
        const successBody = {
            success: true,
            data: { records: [{ name: 'Ada', internal_note: 'do not ship' }], total: 1 },
            meta: undefined,
        };
        expect(valueOf(applyOutputMapping(endpoint, successBody))).toEqual({
            success: true,
            data: { count: 1, first: 'Ada' },
            meta: undefined,
        });
        // The allow-list property: what the pipeline returned but the
        // declaration did not name is gone.
        expect(JSON.stringify(valueOf(applyOutputMapping(endpoint, successBody)))).not.toContain('internal_note');
    });

    it('cannot rewrite the envelope itself', () => {
        // A `target` naming an envelope member writes inside `data`, never over
        // `success` — a declaration must not be able to claim an answer succeeded.
        const endpoint = endpointWith({ outputMapping: [{ source: 'total', target: 'success' }] });
        const mapped = valueOf(applyOutputMapping(endpoint, { success: true, data: { total: 3 }, meta: undefined }));
        expect(mapped).toEqual({ success: true, data: { success: 3 }, meta: undefined });
    });

    it('projects the body itself when it carries no `data` member', () => {
        const endpoint = endpointWith({ outputMapping: [{ source: 'a', target: 'b' }] });
        expect(valueOf(applyOutputMapping(endpoint, { a: 1, c: 2 }))).toEqual({ b: 1 });
    });

    it('does not mutate the success body it was given', () => {
        const endpoint = endpointWith({ outputMapping: [{ source: 'total', target: 'count' }] });
        const successBody = { success: true, data: { total: 1 }, meta: undefined };
        applyOutputMapping(endpoint, successBody);
        expect(successBody.data).toEqual({ total: 1 });
    });
});

describe('a declaration this runtime cannot serve is refused, never ignored', () => {
    it('refuses `transform` — the key #5137 was filed over', () => {
        const endpoint = endpointWith({
            inputMapping: [
                { source: 'firstName', target: 'first_name' },
                { source: 'price', target: 'amount', transform: 'convertToInt' },
            ],
        });
        const error = expectRefusal(
            rejectionOf(applyInputMapping(endpoint, { price: '3' })),
            'inputMapping[1].transform', 'convertToInt', 'showcase_inquiries', '#5040',
        );
        // The prescription, not just the verdict: an author has to be told what
        // to do instead, or the refusal is only half a signal.
        expect(String(error.hint)).toContain('publish');
    });

    it('refuses it on the output side too, and before anything is executed', () => {
        const endpoint = endpointWith({
            outputMapping: [{ source: 'total', target: 'count', transform: 'formatNumber' }],
        });
        expectRefusal(rejectionOf(applyOutputMapping(endpoint, { success: true, data: {}, meta: undefined })),
            'outputMapping[0].transform', 'formatNumber');
        // The same verdict is available WITHOUT a result to apply it to, which
        // is what lets the step refuse before it delegates.
        expectRefusal(mappingDeclarationRejection(endpoint, 'outputMapping')!, 'outputMapping[0].transform');
    });

    it.each([
        ['an empty source', { source: '', target: 'a' }, 'inputMapping[0].source'],
        ['an empty target', { source: 'a', target: '' }, 'inputMapping[0].target'],
        ['an empty segment', { source: 'a..b', target: 'c' }, 'inputMapping[0].source'],
        ['a trailing dot', { source: 'a', target: 'b.' }, 'inputMapping[0].target'],
        ['a prototype key on the source', { source: '__proto__.x', target: 'a' }, 'inputMapping[0].source'],
        ['a prototype key on the target', { source: 'a', target: 'constructor.x' }, 'inputMapping[0].target'],
    ])('refuses %s', (_name, entry, mentions) => {
        const endpoint = endpointWith({ inputMapping: [entry] });
        expectRefusal(rejectionOf(applyInputMapping(endpoint, { a: 1 })), mentions);
    });

    it('cannot be made to pollute Object.prototype', () => {
        const endpoint = endpointWith({ inputMapping: [{ source: 'a', target: '__proto__.polluted' }] });
        expect(applyInputMapping(endpoint, { a: 'boom' }).ok).toBe(false);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('refuses two entries that write the same target', () => {
        const endpoint = endpointWith({
            inputMapping: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x' }],
        });
        expectRefusal(rejectionOf(applyInputMapping(endpoint, { a: 1, b: 2 })),
            'inputMapping[1].target', 'inputMapping[0].target');
    });

    it('refuses an entry that writes INSIDE another entry\'s target', () => {
        // `x` then `x.y`: the second would silently discard the first. Either
        // order is the same collision.
        const nested = endpointWith({
            inputMapping: [{ source: 'a', target: 'x' }, { source: 'b', target: 'x.y' }],
        });
        expectRefusal(rejectionOf(applyInputMapping(nested, { a: 1, b: 2 })), 'inputMapping[1].target');

        const reversed = endpointWith({
            inputMapping: [{ source: 'b', target: 'x.y' }, { source: 'a', target: 'x' }],
        });
        expectRefusal(rejectionOf(applyInputMapping(reversed, { a: 1, b: 2 })), 'inputMapping[1].target');
    });

    it('allows sibling targets under one parent', () => {
        const endpoint = endpointWith({
            inputMapping: [{ source: 'a', target: 'x.a' }, { source: 'b', target: 'x.b' }],
        });
        expect(valueOf(applyInputMapping(endpoint, { a: 1, b: 2 }))).toEqual({ x: { a: 1, b: 2 } });
    });
});

describe('the declaration verdict is per key and data-independent', () => {
    it('is `undefined` when the key is absent or clean', () => {
        expect(mappingDeclarationRejection(endpointWith(), 'inputMapping')).toBeUndefined();
        expect(mappingDeclarationRejection(endpointWith(), 'outputMapping')).toBeUndefined();
        const clean = endpointWith({ inputMapping: [{ source: 'a.b', target: 'c.d' }] });
        expect(mappingDeclarationRejection(clean, 'inputMapping')).toBeUndefined();
    });

    it('judges each key on its own declaration', () => {
        const endpoint = endpointWith({
            inputMapping: [{ source: 'a', target: 'b' }],
            outputMapping: [{ source: 'c', target: 'd', transform: 'upper' }],
        });
        expect(mappingDeclarationRejection(endpoint, 'inputMapping')).toBeUndefined();
        expectRefusal(mappingDeclarationRejection(endpoint, 'outputMapping')!, 'outputMapping[0].transform');
    });
});
