// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7450] A `/data` permission denial must not answer the caller's
 * authorization topology — nor an object they never addressed.
 *
 * `plugin-security`'s CRUD gate attaches
 * `{ operation, object, positions, permissionSets }` to every
 * `PermissionDeniedError`. `@objectstack/rest`'s `mapDataError` never reads it
 * (403 body = `{ error, code, object? }`, the `object` being the one the ROUTE
 * named). The dispatcher spread it — `{ code: 'PERMISSION_DENIED',
 * ...(e.details ?? {}) }` — and `buildApiError` puts everything but the `code`
 * on the wire as `error.details`. `/data` is served by that dispatcher and
 * `domains/data.ts` has no local catch, so an ordinary CRUD denial disclosed
 * the caller's position and permission-set names to the browser.
 *
 * The 2026-08-11 maintainer ruling on #7450: REST's shape is the contract for
 * both transports.
 *
 * ## The cascade case, which is why the object is route-derived
 *
 * `ObjectQL.cascadeDeleteRelations` re-enters `delete()` for every child of the
 * row being deleted, so a child's own trip through the gate throws with
 * `details.object === <child>`. An allowlist that forwarded `details.object`
 * would reach the ruled field set and still answer a third party's API name on
 * exactly the path the card called the sharpest. The dispatcher therefore takes
 * `object` from the request path, like REST takes `req.params.object`, and
 * reads no field of `error.details` at all.
 *
 * ⚠️ Fixture discipline: every denial below carries a FULLY populated `details`
 * — a test whose fixture never had one would pass against the unfixed
 * dispatcher and prove nothing. Each assertion here fails on `main` before the
 * fix (mutation table in the PR).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { PermissionDeniedError } from '@objectstack/plugin-security';

/** The end-user sentence the CRUD gate renders (#7414) — no API names in it. */
const USER_MESSAGE = '您没有执行此操作的权限,如需访问请联系管理员。';

/**
 * REST's answer to the SAME denial, transcribed from the pin PR #7449 added:
 * `packages/rest/src/rest.test.ts`, "never ships a PERMISSION_DENIED developer
 * half or its structured details to the client". That test drives the real
 * `mapDataError` over a fixture identical to {@link cascadeChildDenial} below,
 * down to the position and permission-set names, and asserts exactly this body.
 *
 * Transcribed rather than imported on purpose. `@objectstack/rest`'s public
 * entry does not re-export `mapDataError`, and reaching into its source from
 * here drags eleven of that package's modules outside this package's `rootDir`
 * (TS6059) — the fix for a disclosure card must not widen the reference
 * package's API surface or its type-check debt to buy itself a test. So parity
 * is pinned by TWO tests over ONE fixture: REST's asserts the constant below is
 * what `mapDataError` produces, this file asserts the dispatcher agrees with it.
 * Change either side's shape and the other side's pin fails.
 */
const REST_DENIAL_BODY = {
    error: USER_MESSAGE,
    code: 'PERMISSION_DENIED',
    object: 'app_parent_object',
} as const;

/**
 * A denial raised while cascading `DELETE /data/app_parent_object/1` into a
 * child: the gate's own `object` is the CHILD, which the caller never named.
 */
const cascadeChildDenial = () =>
    new PermissionDeniedError(
        USER_MESSAGE,
        {
            operation: 'delete',
            object: 'app_child_object',
            positions: ['org_member', 'everyone'],
            permissionSets: ['app_reader'],
        },
        "[Security] Access denied: operation 'delete' on object 'app_child_object' " +
            'is not permitted for positions [org_member, everyone]',
    );

/** An ordinary denial on the object the caller addressed. */
const directDenial = (object: string) =>
    new PermissionDeniedError(USER_MESSAGE, {
        operation: 'update',
        object,
        positions: ['org_member', 'everyone'],
        permissionSets: ['app_reader'],
    });

const CALLER = () =>
    ({
        request: {},
        executionContext: {
            userId: 'u_test',
            isSystem: false,
            positions: ['org_member', 'everyone'],
            permissions: ['app_reader'],
            systemPermissions: [],
        },
    }) as any;

describe('/data PERMISSION_DENIED body — #7450', () => {
    let dispatcher: HttpDispatcher;
    let mockObjectQL: any;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockObjectQL = {
            insert: vi.fn(),
            // The protocol-less `/data` fallback reads the row before writing
            // it, so the pre-read has to succeed for the WRITE's denial — the
            // one carrying the cascade payload — to be the error under test.
            find: vi.fn().mockResolvedValue([{ id: '1' }]),
            update: vi.fn(),
            delete: vi.fn(),
            getObjects: vi.fn().mockReturnValue({}),
            registry: { getObject: vi.fn().mockReturnValue({ name: 'app_parent_object' }) },
        };
        const kernel = {
            context: {
                getService: (name: string) => (name === 'objectql' ? mockObjectQL : null),
            },
        } as any;
        dispatcher = new HttpDispatcher(kernel);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        // Without this the spy stacks across cases and the log assertion below
        // counts every earlier case's line too.
        warn.mockRestore();
    });

    const dispatch = (method: string, path: string, body?: any) =>
        dispatcher.dispatch(method, path, body, {}, CALLER());

    it('answers 403 PERMISSION_DENIED with the message and no structured details', async () => {
        mockObjectQL.update.mockRejectedValue(directDenial('app_parent_object'));

        const r = await dispatch('PATCH', '/data/app_parent_object/1', { name: 'x' });

        expect(r.handled).toBe(true);
        expect(r.response?.status).toBe(403);
        // Positive identity first — the absence assertions below only mean
        // something on top of a body that really is the denial.
        expect(r.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(r.response?.body?.error?.message).toBe(USER_MESSAGE);
        // The route's own object still rides: the caller named it themselves.
        expect(r.response?.body?.error?.details).toEqual({ object: 'app_parent_object' });
    });

    it('never serialises positions or permissionSets', async () => {
        mockObjectQL.update.mockRejectedValue(directDenial('app_parent_object'));

        const r = await dispatch('PATCH', '/data/app_parent_object/1', { name: 'x' });

        const wire = JSON.stringify(r.response?.body);
        expect(wire).not.toContain('positions');
        expect(wire).not.toContain('permissionSets');
        expect(wire).not.toContain('org_member');
        expect(wire).not.toContain('app_reader');
        // The operator's half of the message is not a details sibling either.
        expect(wire).not.toContain('developerMessage');
        expect(wire).not.toContain('[Security]');
    });

    it('does NOT name a cascade child the caller never addressed', async () => {
        mockObjectQL.delete.mockRejectedValue(cascadeChildDenial());

        const r = await dispatch('DELETE', '/data/app_parent_object/1');

        expect(r.response?.status).toBe(403);
        // The whole point: `details.object` said `app_child_object`.
        expect(JSON.stringify(r.response?.body)).not.toContain('app_child_object');
        expect(r.response?.body?.error?.details?.object).toBe('app_parent_object');
    });

    // The mirror case — a denial on a route whose path names no object, where
    // REST's `...(object ? { object } : {})` omits the field — is pinned at the
    // builder in `../security/permission-denied-envelope.test.ts`. It is not
    // reachable end-to-end through `/data`: that domain answers 400 "Object
    // name required" before any gate runs.

    it('logs the withheld diagnostics server-side rather than dropping them', async () => {
        mockObjectQL.delete.mockRejectedValue(cascadeChildDenial());

        await dispatch('DELETE', '/data/app_parent_object/1');

        const lines = warn.mock.calls
            .map((c: unknown[]) => String(c[0]))
            .filter((l: string) => l.includes('PERMISSION_DENIED'));
        expect(lines).toHaveLength(1);
        const line = lines[0]!;
        expect(line).toContain('DELETE /data/app_parent_object/1');
        // Everything the wire lost is here — including the cascade child, which
        // is the field an operator debugging a false denial most needs.
        expect(line).toContain('object=app_child_object');
        expect(line).toContain('positions=[org_member, everyone]');
        expect(line).toContain('permissionSets=[app_reader]');
    });

    /**
     * The card's third decision: "either way the two transports should agree on
     * what a PERMISSION_DENIED body carries".
     *
     * The two envelopes NEST differently — REST is flat, the dispatcher wraps in
     * `success` / `error` — and this card does not change that. What has to
     * agree is the semantic content, which is what leaked. So the comparison is
     * field-by-field against {@link REST_DENIAL_BODY}, the body REST's own pin
     * asserts for this identical error.
     */
    it('discloses exactly what @objectstack/rest discloses for the same denial', async () => {
        mockObjectQL.delete.mockRejectedValue(cascadeChildDenial());

        const runtime = await dispatch('DELETE', '/data/app_parent_object/1');
        const error = runtime.response?.body?.error;

        expect(runtime.response?.status).toBe(403);
        expect({
            error: error?.message,
            code: error?.code,
            object: (error?.details as { object?: string } | undefined)?.object,
        }).toEqual({ ...REST_DENIAL_BODY });

        // Nothing rides beyond those three: `details` holds the object alone,
        // and no other key was smuggled onto the error member.
        expect(error?.details).toEqual({ object: REST_DENIAL_BODY.object });
        expect(Object.keys(error ?? {}).sort()).toEqual(['code', 'details', 'httpStatus', 'message']);

        const wire = JSON.stringify(runtime.response?.body);
        expect(wire).not.toContain('positions');
        expect(wire).not.toContain('permissionSets');
        expect(wire).not.toContain('app_child_object');
    });
});
