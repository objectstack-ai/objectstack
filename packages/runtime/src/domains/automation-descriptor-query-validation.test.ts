// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7360 — the descriptor routes' query parameters, at the boundary that reads
 * them: `GET /api/v1/automation/actions` (`?paradigm` / `?source` /
 * `?category`) and `GET /api/v1/automation/connectors` (`?type`).
 *
 * All four compared a RAW query value against a string field:
 *
 * ```ts
 * actions.filter((a) => Array.isArray(a?.paradigms) && a.paradigms.includes(query.paradigm))
 * actions.filter((a) => a?.source === query.source)
 * connectors.filter((c) => c?.type === query.type)
 * ```
 *
 * A repeated parameter arrives as an ARRAY from every query parser these routes
 * run behind, and an array is never `===` any string and never a member of
 * `paradigms[]`. So `?source=builtin&source=plugin` — a caller widening its
 * filter, or a UI serialising a multi-select the obvious way — answered **200
 * with zero descriptors**, and the designer palette reads that as "this
 * deployment registers no actions". That is a different sentence from "no
 * actions matched", and nothing in the response tells them apart. A structured
 * `?type[$ne]=x` fails the same way.
 *
 * This is #7300/#6928's family but NOT its mechanism, which is why the fix is
 * `parseStringParam` and not a new gate: there is no coercion here and no
 * invented value — the filter is simply never satisfiable. The refusal is the
 * house shape (`validationFailure` → 400 `VALIDATION_FAILED` +
 * `details.fields[]` carrying an ADR-0114 `invalid_type`), the same one the
 * runs branch of this file already makes (`automation-runs-query-validation.test.ts`).
 *
 * Two halves are asserted, and the second constrains the fix hardest:
 *
 *  1. REFUSAL — a non-string answers `400` with `error.code ===
 *     'VALIDATION_FAILED'` and a field entry naming the parameter. BOTH the
 *     code and the status are asserted on every refusal case, never a bare
 *     `toThrow()`: the unfixed handler does not throw for these inputs at all,
 *     it answers 200 with an empty registry, so a throw-only assertion would be
 *     pinning the absence of a throw rather than the defect. The defect is the
 *     missing envelope.
 *  2. PRESERVATION — every STRING keeps the answer it had, including one that
 *     names no live paradigm/source/category/type. "No actions of that source"
 *     is a legitimate empty list; it is only "an empty list for a filter that
 *     could never match" that is being closed here.
 *
 * The wire mapping of the thrown shape to `400` + `details.fields[]` is not
 * re-proved here — it is one mapping for every domain handler, pinned at both
 * dispatcher error exits by `dispatcher-validation-error.test.ts` (#3918).
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

/** A registry with enough shape for every filter to have something to match. */
const ACTIONS = [
    { type: 'create_record', name: 'Create record', paradigms: ['flow', 'action'], source: 'builtin', category: 'crud' },
    { type: 'send_email', name: 'Send email', paradigms: ['flow'], source: 'builtin', category: 'messaging' },
    { type: 'slack_post', name: 'Slack post', paradigms: ['action'], source: 'plugin', category: 'messaging' },
];

const CONNECTORS = [
    { name: 'rest', type: 'rest', actions: [] },
    { name: 'slack', type: 'chat', actions: [] },
];

/** An automation slot whose descriptor registries are non-empty and recorded. */
function makeDispatcher() {
    const getActionDescriptors = vi.fn(() => ACTIONS);
    const getConnectorDescriptors = vi.fn(() => CONNECTORS);
    const services: Record<string, unknown> = {
        automation: { getActionDescriptors, getConnectorDescriptors, handlerReady: true },
    };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), getActionDescriptors, getConnectorDescriptors };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);

/**
 * Drive one descriptor route with a raw query object, the way the HTTP layer
 * delivers it, and report the refusal as the wire would: the status is the one
 * both dispatcher error exits derive for a thrown validation failure carrying
 * no `.status` of its own (`errorFromThrown`, `errorResponseBase` — #3918).
 */
async function refusalFor(route: 'actions' | 'connectors', query: Record<string, unknown>) {
    const { dispatcher, getActionDescriptors, getConnectorDescriptors } = makeDispatcher();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleAutomation(route, 'GET', undefined, CTX(), query)).response;
    } catch (e) {
        thrown = e;
    }
    expect(
        thrown,
        `?${route} ${JSON.stringify(query)} was accepted (answered ${JSON.stringify(response)}) instead of refused`,
    ).toBeDefined();
    const details = validationFailureDetails(thrown);
    const status =
        typeof (thrown as any)?.status === 'number' ? (thrown as any).status
        : details ? VALIDATION_FAILED_STATUS
        : 500;
    return { details, status, getActionDescriptors, getConnectorDescriptors, message: (thrown as Error).message };
}

/** Drive one descriptor route to its 200 and hand back the served payload. */
async function listWith(route: 'actions' | 'connectors', query: Record<string, unknown> | undefined) {
    const { dispatcher } = makeDispatcher();
    const result = await dispatcher.handleAutomation(route, 'GET', undefined, CTX(), query);
    return { status: result.response?.status, data: (result.response as any)?.body?.data ?? (result.response as any)?.data };
}

// A repeated parameter and a structured value are the two spellings a raw-HTTP
// caller reaches for, and both were unsatisfiable filters served as a 200. A
// number is what an in-process `dispatch()` delegation can hand over.
const NON_STRINGS: Array<[string, unknown]> = [
    ['repeated parameter', ['a', 'b']],
    ['structured', { $ne: 'a' }],
    ['numeric', 7],
];

describe('#7360 — GET /automation/actions refuses a non-string filter instead of serving an empty palette', () => {
    describe.each(['paradigm', 'source', 'category'])('?%s=', (param) => {
        it.each(NON_STRINGS)('refuses a %s with 400 VALIDATION_FAILED', async (_label, raw) => {
            const { details, status } = await refusalFor('actions', { [param]: raw });

            // ADR-0112: the envelope, not merely the throw — `code` AND
            // `status`. Unfixed, this input answered 200 `{actions: [], total: 0}`.
            expect(details?.code).toBe('VALIDATION_FAILED');
            expect(status).toBe(400);
            // ADR-0114: the field-addressed half names the parameter and the
            // constraint it violated, so a caller can point at the input. No new
            // vocabulary — `invalid_type` is the mapping `parseStringParam`
            // already makes for exactly this condition.
            expect(details?.fields).toEqual([
                { field: param, code: 'invalid_type', message: expect.stringContaining(`\`${param}\``) },
            ]);
        });
    });

    it('refuses the widening spelling the card was filed on — ?source=builtin&source=plugin', async () => {
        // The literal reported input. A caller asking for TWO sources got the
        // answer "this deployment registers no actions at all"; a registry of
        // three, two of them `builtin`, was sitting right there.
        const { details, status } = await refusalFor('actions', { source: ['builtin', 'plugin'] });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'source', code: 'invalid_type', message: expect.stringContaining('a repeated parameter') },
        ]);
    });

    it('names the offending value in the message, capped so the body cannot be stuffed', async () => {
        const { message } = await refusalFor('actions', { paradigm: { $ne: 'x'.repeat(500) } });

        expect(message).toContain('expected a single string');
        expect(message.length).toBeLessThan(200);
    });

    it('refuses before the registry is read at all', async () => {
        // Ordering: the refusal is the boundary's, not a filter that ran and
        // found nothing, so the service is never asked for descriptors.
        const { getActionDescriptors } = await refusalFor('actions', { category: ['crud', 'messaging'] });

        expect(getActionDescriptors).not.toHaveBeenCalled();
    });
});

describe('#7360 — GET /automation/connectors refuses a non-string ?type=', () => {
    it.each(NON_STRINGS)('refuses a %s with 400 VALIDATION_FAILED', async (_label, raw) => {
        const { details, status, getConnectorDescriptors } = await refusalFor('connectors', { type: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'type', code: 'invalid_type', message: expect.stringContaining('`type`') },
        ]);
        expect(getConnectorDescriptors).not.toHaveBeenCalled();
    });
});

describe('#7360 — every value that had a defensible answer keeps it', () => {
    it.each([
        // [label, query, the descriptor `type`s that must be served]
        ['?paradigm=flow', { paradigm: 'flow' }, ['create_record', 'send_email']],
        ['?paradigm=action', { paradigm: 'action' }, ['create_record', 'slack_post']],
        ['?source=builtin', { source: 'builtin' }, ['create_record', 'send_email']],
        ['?category=messaging', { category: 'messaging' }, ['send_email', 'slack_post']],
        ['two filters together', { paradigm: 'flow', category: 'messaging' }, ['send_email']],
        // The falsy gate these filters always had: an absent or empty spelling
        // means "no filter" and must not become a new 400.
        ['no filters at all', {}, ['create_record', 'send_email', 'slack_post']],
        ['?source= (empty)', { source: '' }, ['create_record', 'send_email', 'slack_post']],
        ['source: null', { source: null }, ['create_record', 'send_email', 'slack_post']],
    ])('%s answers 200 with the same descriptors as before', async (_label, query, expected) => {
        const { status, data } = await listWith('actions', query);

        expect(status).toBe(200);
        expect(data.actions.map((a: any) => a.type)).toEqual(expected);
        expect(data.total).toBe(expected.length);
    });

    it.each([
        ['names no live source', { source: 'marketplace' }],
        ['names no live paradigm', { paradigm: 'agent' }],
        ['names no live category', { category: 'billing' }],
        ['right word, wrong case', { source: 'BUILTIN' }],
    ])('a STRING that %s still filters to a legitimate empty list, not a 400', async (_label, query) => {
        // The line this fix must not cross. "No actions of that source" is an
        // honest empty answer and stays one — only a filter that could never
        // have matched anything is refused. A caller that types `marketplace`
        // is asking a well-formed question with a genuinely empty answer.
        const { status, data } = await listWith('actions', query);

        expect(status).toBe(200);
        expect(data.actions).toEqual([]);
        expect(data.total).toBe(0);
    });

    it.each([
        ['?type=rest', { type: 'rest' }, ['rest']],
        ['?type=chat', { type: 'chat' }, ['chat']],
        ['?type=ftp (no such connector)', { type: 'ftp' }, []],
        ['?type= (empty)', { type: '' }, ['rest', 'chat']],
        ['no filter', {}, ['rest', 'chat']],
    ])('connectors: %s answers 200 unchanged', async (_label, query, expected) => {
        const { status, data } = await listWith('connectors', query);

        expect(status).toBe(200);
        expect(data.connectors.map((c: any) => c.type)).toEqual(expected);
        expect(data.total).toBe(expected.length);
    });

    it('passes no query object at all without incident', async () => {
        const { status, data } = await listWith('actions', undefined);

        expect(status).toBe(200);
        expect(data.total).toBe(3);
    });

    it('still refuses an anonymous caller with 401 before it ever looks at the query', async () => {
        // Ordering matters: a malformed query from an unauthenticated caller
        // must not become a 400 that confirms the route is wired and serveable
        // (#5519's anonymous baseline stands ahead of every parse on this
        // domain).
        const { dispatcher, getActionDescriptors } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            'actions', 'GET', undefined, { request: {} } as any, { source: ['builtin', 'plugin'] },
        );

        expect(result.response?.status).toBe(401);
        expect(getActionDescriptors).not.toHaveBeenCalled();
    });
});

describe('#7360 — the refusal does not depend on which automation service is mounted', () => {
    /** A service that is serveable but does not implement the optional methods. */
    function dispatcherWithoutDescriptors() {
        const services: Record<string, unknown> = { automation: { listFlows: () => [], handlerReady: true } };
        const resolve = (name: string) => services[name];
        const kernel: any = {
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
            context: { getService: resolve },
        };
        return new HttpDispatcher(kernel);
    }

    it.each([
        ['actions', { source: ['builtin', 'plugin'] }, 'source'],
        ['connectors', { type: { $ne: 'rest' } }, 'type'],
    ] as const)('refuses on /%s even where the descriptor method is unimplemented', async (route, query, field) => {
        // The parse runs AHEAD of the capability probe on purpose. A malformed
        // query is malformed whichever service this deployment mounts, and a
        // 400 that appeared only where `getActionDescriptors` happens to be
        // implemented would be a contract that varies by deployment — the
        // caller could not tell a rejected filter from an empty registry, which
        // is the very confusion this card is about.
        let thrown: unknown;
        try {
            await dispatcherWithoutDescriptors().handleAutomation(route, 'GET', undefined, CTX(), query);
        } catch (e) {
            thrown = e;
        }

        const details = validationFailureDetails(thrown);
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(details?.fields?.[0]?.field).toBe(field);
    });

    it('still reports an empty-but-valid registry for a WELL-FORMED query there', async () => {
        // Preserved: the unimplemented-method branch answers 200 `{actions: [],
        // total: 0}` rather than a 404, and a legitimate filter does not change
        // that.
        const result = await dispatcherWithoutDescriptors()
            .handleAutomation('actions', 'GET', undefined, CTX(), { source: 'builtin' });

        expect(result.response?.status).toBe(200);
        const data = (result.response as any)?.body?.data ?? (result.response as any)?.data;
        expect(data).toEqual({ actions: [], total: 0 });
    });
});
