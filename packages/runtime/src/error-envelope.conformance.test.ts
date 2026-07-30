// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-envelope conformance for the runtime dispatcher stack (#3842).
 *
 * #3687 gave `service-storage` and `service-i18n` a suite of this shape and
 * left the dispatcher pinned instead of fixed, because `error.code` there was
 * the HTTP status and moving it needed a consumer sweep. The sweep happened;
 * this is the guard that replaces the pin.
 *
 * Two directions, same as the storage/i18n suites:
 *
 *  1. **Runtime** — every distinct way this stack produces an error code is
 *     DRIVEN through the real dispatcher and the body parsed against
 *     `BaseResponseSchema` / `ApiErrorSchema` **imported from `packages/spec`**,
 *     not a local restatement that could drift from the schema it claims to
 *     check. There are four such ways (derived from status, promoted from
 *     `details.code`, spelled from `DispatcherErrorCode`, lifted off a thrown
 *     error) and one case per parking spot the fix collapsed.
 *
 *  2. **Source scan** — the modules are scanned so a NEW branch cannot quietly
 *     reintroduce a numeric `code`, a `type`-as-code sibling, or a hand-rolled
 *     envelope. Without this the suite would only ever cover the branches that
 *     existed the day it was written — which is exactly how four sites drifted
 *     into three different parking spots in the first place.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiErrorSchema, BaseResponseSchema, DispatcherErrorCode } from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildApiError, splitSemanticCode } from './error-envelope.js';

/** Minimal kernel — these branches fail before any service is reached. */
function makeDispatcher(kernel: any = { context: { getService: () => null } }) {
    return new HttpDispatcher(kernel as any);
}

/**
 * The assertions every dispatcher error body must satisfy, whatever produced
 * it. Spelled once so a new case cannot accidentally check less than the others.
 */
function expectConformantError(response: { status: number; body: any } | undefined) {
    expect(response, 'branch produced no response').toBeTruthy();
    const body = response!.body;

    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(false);

    const parsed = ApiErrorSchema.safeParse(body.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);

    // The bug in one line: `code` is a semantic string, never the status.
    expect(typeof body.error.code).toBe('string');
    expect(body.error.code).not.toBe(String(response!.status));
    expect(body.error.httpStatus).toBe(response!.status);

    // And the parking spots are empty — `details` is genuine context only.
    expect(body.error.type).toBeUndefined();
    expect(body.error.details?.code).toBeUndefined();
    expect(body.error.details?.type).toBeUndefined();

    return body.error;
}

describe('#3842 — every dispatcher error exit answers in the declared envelope', () => {
    it('derives a catalogued code when the branch has none of its own (400)', async () => {
        const result = await makeDispatcher().handleActions('', 'POST', {}, { request: {} });

        const error = expectConformantError(result.response);
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.message).toBe('Path must be /actions/:object/:action');
    });

    it('derives a catalogued code for a 405 and a 501 too', async () => {
        // The two statuses `StandardErrorCode` had no member for until #3842 —
        // without them a 405 would have derived the generic 4xx bucket and read
        // as a validation failure.
        const notAllowed = await makeDispatcher().handleActions('/task/close', 'GET', {}, { request: {} });
        expect(expectConformantError(notAllowed.response).code).toBe('METHOD_NOT_ALLOWED');

        const notImplemented = await makeDispatcher().handleI18n('/labels/account', 'GET', {}, { request: {} });
        expect(expectConformantError(notImplemented.response).code).toBe('NOT_IMPLEMENTED');
    });

    it('derives a catalogued code for a 503 (the /ready probe)', async () => {
        const kernel: any = { context: { getService: () => null }, getState: () => 'stopping' };
        const result = await makeDispatcher(kernel).dispatch('GET', '/ready', {}, {}, { request: {} });

        const error = expectConformantError(result.response);
        expect(error.code).toBe('SERVICE_UNAVAILABLE');
        // Genuine context survives the split — only the code was lifted out.
        expect(error.details).toEqual({ state: 'stopping' });
    });

    it('spells a route-resolution failure from the spec enum, not a third field', async () => {
        const result = await makeDispatcher().dispatch('POST', '', {}, {}, { request: {} });

        const error = expectConformantError(result.response);
        expect(error.code).toBe(DispatcherErrorCode.enum.ROUTE_NOT_FOUND);
        // `route` / `hint` stay siblings — `DispatcherErrorResponseSchema`
        // declares them as part of this error, not as `details` context.
        expect(typeof error.hint).toBe('string');
    });

    it('promotes a gate code out of `details` into the declared field', async () => {
        // The `PROJECT_MEMBERSHIP_REQUIRED` gate — the one site that used
        // `details.type`, the third of the three parking spots.
        const ql = { find: vi.fn().mockResolvedValue([]) };
        const kernel: any = {
            context: {
                getService: (name: string) => {
                    if (name === 'auth') {
                        return { api: { getSession: async () => ({ user: { id: 'user-1' } }) } };
                    }
                    if (name === 'objectql') return ql;
                    return null;
                },
            },
        };
        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: true });
        const response = await (dispatcher as any).enforceProjectMembership(
            { request: { headers: {} }, environmentId: 'proj-private' },
            '/api/v1/environments/proj-private/data/task',
        );

        const error = expectConformantError(response);
        expect(error.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
        expect(error.details).toEqual({ environmentId: 'proj-private', userId: 'user-1' });
    });

    it('lifts a thrown error’s own code into the declared field', async () => {
        const thrown = Object.assign(new Error('publish backend unavailable'), {
            code: 'CONNECTOR_UPSTREAM_UNAVAILABLE',
            status: 502,
        });
        const response = (makeDispatcher() as any).errorFromThrown(thrown);

        const error = expectConformantError(response);
        expect(error.code).toBe('CONNECTOR_UPSTREAM_UNAVAILABLE');
    });

    it('keeps the `Allow` header on the MCP 405 while sharing the body builder', async () => {
        const result = await makeDispatcher().handleMcpSkill('POST', { request: {} } as any);

        expect(result.response?.headers).toEqual({ Allow: 'GET' });
        const error = expectConformantError(result.response);
        expect(error.code).toBe('METHOD_NOT_ALLOWED');
    });
});

describe('#3842 — buildApiError precedence', () => {
    it('prefers an explicit code over a promoted one over a derived one', () => {
        expect(buildApiError({ message: 'm', httpStatus: 403, code: 'EXPLICIT' }).code).toBe('EXPLICIT');
        expect(buildApiError({ message: 'm', httpStatus: 403, details: { code: 'PROMOTED' } }).code)
            .toBe('PROMOTED');
        expect(buildApiError({ message: 'm', httpStatus: 403 }).code).toBe('PERMISSION_DENIED');
    });

    it('drops `details` entirely when the code was all it carried', () => {
        // An empty object left behind would read as "there is context here".
        expect(buildApiError({ message: 'm', httpStatus: 403, details: { code: 'X' } }))
            .not.toHaveProperty('details');
    });

    it('leaves a non-string `code` in `details` rather than promoting it', () => {
        // A numeric `code` in a details payload is context (a driver errno, say),
        // not a semantic code — promoting it would put a number straight back
        // into the field this whole change exists to keep a string.
        const error = buildApiError({ message: 'm', httpStatus: 500, details: { code: 42 } });
        expect(error.code).toBe('INTERNAL_ERROR');
        expect(error.details).toEqual({ code: 42 });
    });

    it('passes a non-object `details` through untouched', () => {
        expect(splitSemanticCode('a string')).toEqual({ details: 'a string' });
        expect(splitSemanticCode(undefined)).toEqual({ details: undefined });
    });
});

describe('#3842 — no dispatcher module may reintroduce the drift', () => {
    // Comments stripped first: these modules' own prose quotes the old shape,
    // and a doc comment is not a code path.
    const read = (file: string) =>
        readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');

    /** Every module that can put a body on this wire surface. */
    const MODULES = [
        './http-dispatcher.ts',
        './dispatcher-plugin.ts',
        './domain-handler-registry.ts',
        './domains/ai.ts',
        './domains/mcp.ts',
    ];

    for (const file of MODULES) {
        it(`${file} never writes a numeric \`code\``, () => {
            const hits = [...read(file).matchAll(/\bcode:\s*\d/g)];
            expect(hits, `numeric code literals in ${file}: ${hits.map((m) => m[0]).join(', ')}`)
                .toHaveLength(0);
        });

        it(`${file} never revives \`type\` as an error-code sibling`, () => {
            const hits = [...read(file).matchAll(/\btype:\s*'[A-Z_]{4,}'/g)];
            expect(hits, `type-as-code in ${file}: ${hits.map((m) => m[0]).join(', ')}`)
                .toHaveLength(0);
        });

        it(`${file} builds every error body through the one builder`, () => {
            // Each `success: false` must be the builder's, so the envelope keeps
            // living in exactly one place no matter how many branches appear.
            // The comma form is the object LITERAL; `success: false;` in a type
            // annotation describes the shape rather than emitting one.
            const source = read(file);
            const envelopes = [...source.matchAll(/success:\s*false\s*,/g)].length;
            const built = [...source.matchAll(/\b(buildApiError|apiErrorResponse)\s*\(/g)].length;
            expect(built, `${file} has ${envelopes} error envelope(s) but ${built} builder call(s)`)
                .toBeGreaterThanOrEqual(envelopes);
        });
    }

    it('the builder itself is the only place the envelope shape is written', () => {
        const source = read('./error-envelope.ts');
        expect([...source.matchAll(/success:\s*false\s*,/g)]).toHaveLength(1);
    });
});
