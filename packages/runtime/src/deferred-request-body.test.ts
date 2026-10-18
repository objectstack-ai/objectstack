// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { deferRequestBody, readDispatchedBody, UNRESOLVED_REQUEST_BODY_READ } from './deferred-request-body.js';

/**
 * The two halves of a body handed to `dispatch()` unread (#24151): the mount
 * defers, the domain reads once it has admitted the caller. The socket-level
 * pins are `dispatcher-body-after-anonymous-floor.hono.integration.test.ts`;
 * these hold the value's own contract.
 */

/** A request whose `body` getter counts its reads and answers `value`, or throws `refusal`. */
function requestWith(value: unknown, refusal?: Error): { req: { readonly body: unknown }; reads: () => number } {
    let reads = 0;
    const req = {
        get body(): unknown {
            reads += 1;
            if (refusal) throw refusal;
            return value;
        },
    };
    return { req, reads: () => reads };
}

describe('deferRequestBody / readDispatchedBody', () => {
    it('defers: building, holding and passing the value along reads nothing', () => {
        const { req, reads } = requestWith({ name: 'probe' });
        const deferred = deferRequestBody(req);

        expect(typeof deferred).toBe('object');
        expect(deferred ?? 'nullish').toBe(deferred);
        const carried = [deferred][0];
        expect(carried).toBe(deferred);
        expect(reads()).toBe(0);
    });

    it('reads the request body when the domain resolves it, returning that exact value', () => {
        for (const value of [{ name: 'probe' }, [{ jsonrpc: '2.0' }], null, 'text', 0, false]) {
            const { req, reads } = requestWith(value);
            const deferred = deferRequestBody(req);

            expect(readDispatchedBody(deferred)).toBe(value);
            expect(reads()).toBe(1);
        }
    });

    it("lets the transport's refusal out of the resolving read, unchanged", () => {
        const refusal = Object.assign(new Error('The request body could not be parsed as JSON'), { status: 400, code: 'INVALID_REQUEST' });
        const { req, reads } = requestWith(undefined, refusal);
        const deferred = deferRequestBody(req);

        expect(reads()).toBe(0);
        let thrown: unknown;
        try {
            readDispatchedBody(deferred);
        } catch (err) {
            thrown = err;
        }
        // The very object the transport threw: its `status` and `code` are what it answers.
        expect(thrown).toBe(refusal);
        expect(reads()).toBe(1);
    });

    it('hands every value it did not defer back as it is, reading nothing from it', () => {
        const refusedOnRead = new Proxy(Object.create(null) as object, {
            get: () => { throw new Error('read'); },
            has: () => { throw new Error('read'); },
            ownKeys: () => { throw new Error('read'); },
            getOwnPropertyDescriptor: () => { throw new Error('read'); },
            getPrototypeOf: () => { throw new Error('read'); },
        });
        const parsed = { name: 'probe' };
        for (const value of [parsed, refusedOnRead, undefined, null, 'text', 0, [1]]) {
            expect(readDispatchedBody(value)).toBe(value);
        }
    });

    it('refuses loudly when a deferred body is read without being resolved, and never reads the request', () => {
        const { req, reads } = requestWith({ name: 'probe' });
        const deferred = deferRequestBody(req) as Record<string, unknown>;

        /** The name of what `read` threw, or `'nothing'` when it returned. */
        const thrownName = (read: () => unknown): string => {
            try {
                read();
            } catch (err) {
                return (err as Error).name;
            }
            return 'nothing';
        };
        for (const read of [
            () => deferred.name,
            () => 'name' in deferred,
            () => Object.keys(deferred),
            () => ({ ...deferred }),
            () => JSON.stringify(deferred),
        ]) {
            expect(thrownName(read)).toBe(UNRESOLVED_REQUEST_BODY_READ);
        }
        expect(reads()).toBe(0);
    });
});
