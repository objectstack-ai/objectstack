// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST `/actions` — the object-less registration key, and failure status (#3913).
 *
 * Two independent defects that compounded into "global actions are
 * unreachable, and when they fail you are told they succeeded":
 *
 *  1. **Registration key vs lookup key.** Both writers register an
 *     objectName-less action under the literal `'global'` — `AppPlugin`
 *     (`action.object || 'global'`) and `ObjectQLPlugin.actionObjectKey`. The
 *     REST fallback probed `'*'`, and `engine.executeAction` is an
 *     exact-string `Map` lookup with no wildcard semantics, so the probe could
 *     only ever miss: `Action 'log_call' on object '*' not found`.
 *     `POST /actions/global/log_call` worked by ACCIDENT (the path segment
 *     happened to spell the registration key) and `POST /actions//log_call`
 *     never worked at all.
 *
 *  2. **A miss was wrapped as transport success.** The not-found exit called
 *     `deps.success(...)`, which is always `{status: 200, body: {success:
 *     true, data}}` — so "this action does not exist" went out as HTTP 200
 *     `{success: true, data: {success: false, error}}`, and every caller that
 *     did not hand-unwrap the inner envelope (the shipped console among them,
 *     which showed a green toast) swallowed it.
 *
 *     Only the DISPATCH FAILURE moved to a status. A handler that RAN and
 *     rejected still reports `{success: false, error, code?, fields?}` at HTTP
 *     200 — that is a business outcome, not a transport error, and #3937 pins
 *     it (`actions-validation-envelope.test.ts`). The line this file asserts is
 *     "did a handler run": below it the payload, above it the status, alongside
 *     the pre-dispatch answers the route already gives one (403 denied, 400
 *     wrong type, 503 unavailable).
 *
 * The engine double here is deliberately faithful on the one point that
 * matters: a real `Map` keyed `<object>:<action>` that throws
 * `engine.ts`'s verbatim miss message. A double that resolves any key would
 * pass while the bug was live.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

/**
 * A dispatcher over an engine whose action registry is a real exact-string
 * Map — `registered` is keyed exactly as `engine.registerAction` keys it.
 */
function makeDispatcher(opts: {
    registered?: Record<string, (ctx: any) => any>;
    objectDef?: any;
} = {}) {
    const registered = opts.registered ?? {};
    const executeAction = vi.fn(async (object: string, action: string, ctx: any) => {
        const handler = registered[`${object}:${action}`];
        if (!handler) throw new Error(`Action '${action}' on object '${object}' not found`);
        return handler(ctx);
    });
    const objectDef = opts.objectDef;
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (objectDef && name === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (objectDef && name === objectDef.name ? objectDef : undefined),
            getItem: () => undefined,
        },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => (objectDef ? [objectDef] : [])),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel) as any, executeAction };
}

const ctx = (): any => ({ request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } });

describe('REST /actions — object-less ("global") action key (#3913)', () => {
    it('reaches a handler registered under `global` from POST /actions/global/:action', async () => {
        const { dispatcher } = makeDispatcher({
            registered: { 'global:log_call': () => ({ logged: true }) },
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual({ success: true, data: { logged: true } });
    });

    it('reaches the same handler from POST /actions//:action — the empty-object shape', async () => {
        // `filter(Boolean)` eats the empty segment, leaving a single part. That
        // used to 400 as "Path must be /actions/:object/:action"; a lone
        // segment is an action name with no object, so it routes at 'global'.
        const { dispatcher, executeAction } = makeDispatcher({
            registered: { 'global:log_call': () => ({ logged: true }) },
        });

        const res = await dispatcher.handleActions('//log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual({ success: true, data: { logged: true } });
        expect(executeAction).toHaveBeenCalledWith('global', 'log_call', expect.anything());
    });

    it('falls back from the routed object to `global` — the key the writers actually use', async () => {
        // The pre-#3913 fallback rotated to '*', which nothing registers, so
        // an object-scoped route could never reach a global handler.
        const { dispatcher, executeAction } = makeDispatcher({
            registered: { 'global:log_call': () => ({ logged: true }) },
            objectDef: { name: 'crm_contact', actions: [] },
        });

        const res = await dispatcher.handleActions('/crm_contact/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual({ success: true, data: { logged: true } });
        expect(executeAction).toHaveBeenNthCalledWith(1, 'crm_contact', 'log_call', expect.anything());
        expect(executeAction).toHaveBeenNthCalledWith(2, 'global', 'log_call', expect.anything());
    });

    it('still honours a handler registered directly under the legacy `*` key', async () => {
        const { dispatcher } = makeDispatcher({
            registered: { '*:log_call': () => ({ logged: 'wildcard' }) },
            objectDef: { name: 'crm_contact', actions: [] },
        });

        const res = await dispatcher.handleActions('/crm_contact/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual({ success: true, data: { logged: 'wildcard' } });
    });

    it('probes `global` exactly once when the route already names it', async () => {
        const { dispatcher, executeAction } = makeDispatcher({ registered: {} });

        await dispatcher.handleActions('/global/nope', 'POST', {}, ctx());

        const probed = executeAction.mock.calls.map((c: any[]) => c[0]);
        expect(probed).toEqual(['global', '*']);
    });

    it('prefers the object-specific handler over the global one', async () => {
        const { dispatcher } = makeDispatcher({
            registered: {
                'crm_contact:log_call': () => ({ scope: 'object' }),
                'global:log_call': () => ({ scope: 'global' }),
            },
            objectDef: { name: 'crm_contact', actions: [] },
        });

        const res = await dispatcher.handleActions('/crm_contact/log_call', 'POST', {}, ctx());

        expect(res.response.body.data).toEqual({ success: true, data: { scope: 'object' } });
    });

    it('does not try to load a record for an object-less action', async () => {
        const { dispatcher } = makeDispatcher({
            registered: { 'global:log_call': (c: any) => ({ record: c.record }) },
        });

        const res = await dispatcher.handleActions('/global/log_call/rec_1', 'POST', {}, ctx());

        // No `get` against an object named 'global' — only the id echo.
        expect(res.response.body.data.data.record).toEqual({ id: 'rec_1' });
    });

    it('404s an unregistered action, naming the ROUTED object rather than the last probe', async () => {
        const { dispatcher } = makeDispatcher({ registered: {} });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(404);
        expect(res.response.body.success).toBe(false);
        // Not `on object '*'` — an object the caller never asked for, which is
        // exactly the message #3913 was reported with.
        expect(res.response.body.error.message).toBe("Action 'log_call' on object 'global' not found");
    });

    it('routes the empty-object shape through the real dispatcher prefix too', async () => {
        // `createActionsDomain` hands the domain `req.path.substring(8)`, so
        // `/api/v1/actions//log_call` arrives here as `/log_call`. Pin the
        // whole path, not just the domain-relative one — the reported failure
        // was against the full URL.
        const { dispatcher, executeAction } = makeDispatcher({
            registered: { 'global:log_call': () => ({ logged: true }) },
        });

        const res = await dispatcher.dispatch('POST', '/actions//log_call', {}, {}, {
            request: { headers: {} },
        });

        expect(res.response.status).toBe(200);
        expect(executeAction).toHaveBeenCalledWith('global', 'log_call', expect.anything());
    });

    it('still rejects a path with no action segment at all', async () => {
        const { dispatcher } = makeDispatcher({ registered: {} });

        const res = await dispatcher.handleActions('/', 'POST', {}, ctx());

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.message).toMatch(/Path must be/);
    });
});

describe('REST /actions — dispatch failure vs business failure (#3913)', () => {
    it('a handler that RAN and rejected still reports in the payload at HTTP 200', async () => {
        // The line #3913 draws is "did a handler run". This one did, so the
        // failure is a business outcome and stays in the envelope — the
        // contract #3937 pins. Asserted here too so the not-found 404 above
        // can never be widened into "every action failure is a 4xx" by
        // someone reading only this file.
        const { dispatcher } = makeDispatcher({
            registered: {
                'global:log_call': () => {
                    const err: any = new Error("action 'log_call' threw: Contact has no phone number");
                    err.innerMessage = 'Contact has no phone number';
                    throw err;
                },
            },
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data.success).toBe(false);
        // The debug wrapper stays in the server log, not on the wire.
        expect(res.response.body.data.error).toBe('Contact has no phone number');
    });

    it('carries a validation failure\'s code/fields in the payload, unchanged (#3937)', async () => {
        const { dispatcher } = makeDispatcher({
            registered: {
                'global:log_call': () => {
                    const err: any = new Error('Validation failed');
                    err.code = 'VALIDATION_FAILED';
                    err.fields = [{ field: 'phone', message: 'required' }];
                    throw err;
                },
            },
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({
            success: false,
            code: 'VALIDATION_FAILED',
            fields: [{ field: 'phone', message: 'required' }],
        });
    });

    it('leaves the success envelope untouched', async () => {
        // Only the not-found exit moved; a successful action keeps the
        // `{success: true, data: {success: true, data}}` shape the SDK reads.
        const { dispatcher } = makeDispatcher({
            registered: { 'global:log_call': () => ({ id: 'call_1' }) },
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body).toMatchObject({
            success: true,
            data: { success: true, data: { id: 'call_1' } },
        });
    });
});
