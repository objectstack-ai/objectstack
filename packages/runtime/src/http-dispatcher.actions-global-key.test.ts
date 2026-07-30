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
 *     #3913 moved the dispatch failure to a 404; #3962 finished the job —
 *     every failure speaks HTTP (rejection 400, crash 500), success is a
 *     SINGLE wrap (`data` = the handler's return value), and the inner
 *     envelope is gone.
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
    /**
     * [ADR-0110 D3] This file's axis is ADDRESSING, not governance: every case
     * below asks "which key did the route probe, and what envelope came back".
     * An undeclared action is refused since D3, so the double declares
     * whatever name is asked for — a plain script action bound to its own name,
     * which is the very key the URL segment used to be taken as, so the probe
     * order these tests pin is unchanged. Pass `false` to exercise the refusal.
     */
    declared?: boolean;
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
    const declareAny = opts.declared !== false;
    const synthesize = (type: string, name: string) =>
        (declareAny && type === 'action')
            ? { name, type: 'script', target: name, objectName: 'global' }
            : null;
    const metadata: any = {
        load: vi.fn(async (type: string, name: string) => synthesize(type, name)),
        loadDiagnosed: vi.fn(async (type: string, name: string) => ({
            data: synthesize(type, name), degraded: false, errors: [],
        })),
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
        expect(res.response.body.data).toEqual({ logged: true });
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
        expect(res.response.body.data).toEqual({ logged: true });
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
        expect(res.response.body.data).toEqual({ logged: true });
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
        expect(res.response.body.data).toEqual({ logged: 'wildcard' });
    });

    it('probes `global` exactly once when the route already names it', async () => {
        const { dispatcher, executeAction } = makeDispatcher({ registered: {} });

        await dispatcher.handleActions('/global/nope', 'POST', {}, ctx());

        const probed = executeAction.mock.calls.map((c: any[]) => c[0]);
        expect(probed).toEqual(['global', '*']);
    });

    // [ADR-0110 D3] The fixture above declares whatever it is asked for so the
    // addressing cases stay on their own axis. That must not be read as "the
    // object-less route is exempt from governance" — it is not.
    it('refuses an object-less action that has no declaration, before any probe', async () => {
        const { dispatcher, executeAction } = makeDispatcher({
            registered: { 'global:log_call': () => ({ logged: true }) },
            declared: false,
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(404);
        expect(res.response.body.error.message).toMatch(/has no declaration/i);
        expect(executeAction).not.toHaveBeenCalled();
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

        expect(res.response.body.data).toEqual({ scope: 'object' });
    });

    it('does not try to load a record for an object-less action', async () => {
        const { dispatcher } = makeDispatcher({
            registered: { 'global:log_call': (c: any) => ({ record: c.record }) },
        });

        const res = await dispatcher.handleActions('/global/log_call/rec_1', 'POST', {}, ctx());

        // No `get` against an object named 'global' — only the id echo.
        expect(res.response.body.data.record).toEqual({ id: 'rec_1' });
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
    it('a handler that RAN and rejected is a 400 with the business message (#3962)', async () => {
        // Distinct from the 404 above: the 404 says "no such action", the 400
        // says "the action said no". Both speak HTTP since #3962.
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

        expect(res.response.status).toBe(400);
        // The debug wrapper stays in the server log, not on the wire.
        expect(res.response.body.error.message).toBe('Contact has no phone number');
    });

    it('carries a validation failure\'s code/fields in error.details (#3937 → #3962)', async () => {
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

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.response.body.error.details).toMatchObject({
            fields: [{ field: 'phone', message: 'required' }],
        });
    });

    it('serves success as a SINGLE wrap — data is the handler return value (#3962)', async () => {
        // The former inner {success, data} envelope existed only to carry a
        // failure signal at HTTP 200; failures carry a status now.
        const { dispatcher } = makeDispatcher({
            registered: { 'global:log_call': () => ({ id: 'call_1' }) },
        });

        const res = await dispatcher.handleActions('/global/log_call', 'POST', {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body).toMatchObject({
            success: true,
            data: { id: 'call_1' },
        });
    });
});
