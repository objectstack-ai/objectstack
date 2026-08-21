// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8055 — `POST /api/v1/automation` vs a malformed flow definition.
 *
 * Four distinct bad bodies were answered **500 INTERNAL_ERROR**. Every one of
 * the refusals is correct — the definition really is bad, and the engine really
 * does locate the fault — so the substance was never the defect. The CLASS was:
 *
 *  1. a node missing `label`      → 500 carrying a RAW ZOD ISSUE ARRAY
 *     (`{expected:'string', code:'invalid_type', path:['nodes',0,'label']}`)
 *  2. an unknown node key         → 500 `{code:'unrecognized_keys', keys:['next'], …}`
 *  3. a malformed `try_catch`     → 500 `try_catch 'g' try: invalid region — …`
 *  4. an undeclared config key    → 500 carrying the #4277 self-correcting text
 *
 * (4) is the one that matters most. #4277 shaped that message so an authoring
 * agent can fix its own metadata — it names the key, the node, the node type,
 * and the keys the descriptor DOES declare. Delivered under a 500 it says the
 * opposite of what it means: a retry-on-5xx client re-sends a request that can
 * never succeed, and an agent reads "the server broke" instead of "your
 * metadata is wrong". Same error-class mismatch #7535 fixed on the sibling
 * `POST /automation/:name/toggle`, one route over.
 *
 * ## What these tests refuse to accept as a pass
 *
 * `status !== 500` is not the bar, and neither is `status >= 400`: both stay
 * green if the route starts answering 404, or a 400 whose body still carries
 * the raw Zod array. Every case therefore asserts the whole ADR-0112 envelope —
 * `code` AND `status` AND the presence and shape of ADR-0114 `details.fields[]`
 * — plus, per case, the substance that must survive the reclassification:
 *
 *  - case 1 pins the POSITIVE body shape and that no Zod-internal key
 *    (`"expected"`, `"received"`, `"keys"`) appears anywhere on the wire. "The
 *    message changed" would pass for any rewrite, including a worse one.
 *  - case 4 pins the #4277 text itself. A fix that reclassifies to 400 while
 *    flattening the message to "validation failed" has destroyed the thing
 *    worth keeping.
 *
 * ## Where the 500 came from, and why these read `result.response`
 *
 * Before the fix the handler did not catch at all, so the engine's throw left
 * `handleAutomationRequest` — and `dispatch()` re-throws everything that is not
 * a permission denial. The 500 the issue reports is what the transport's outer
 * catch makes of that escape: `dispatcher-plugin`'s `errorResponseBase` maps a
 * thrown error carrying `.issues` to a 500 whose `details.issues` is the raw
 * Zod array, which `dispatcher-validation-error.test.ts` (#3918) already pins
 * as the general rule ("leaves a non-validation error on its old path").
 *
 * The handler now RETURNS the refusal instead, and a returned response is what
 * the plugin serves verbatim — so `result.response` below is the wire answer.
 * Reverse-verified: with the catch arm removed, all six refusal tests go red
 * because the promise REJECTS (no response is produced at this seam at all),
 * while the three contrast controls stay green.
 *
 * ## The fake
 *
 * `registerFlow` here runs the REAL refusals for three of the four cases:
 * `FlowSchema.parse` and `validateControlFlow` are imported from
 * `@objectstack/spec/automation` and are the very calls
 * `AutomationEngine.canonicalizeStoredFlow` makes, in that order. So cases 1-3
 * are produced by production code, not by hand-written fixtures — the messages
 * asserted below were captured from a real parse.
 *
 * Only #4277 is modelled (`undeclaredConfigKeyRefusal`), because that check is
 * descriptor-driven and lives in `@objectstack/service-automation`, which
 * `@objectstack/runtime` does not depend on. It is reproduced from the engine's
 * own construction — `validateNodeConfigKeys`'s `Flow '<name>' rejected:` throw
 * and `collectUndeclaredConfigKeys`'s per-key prescription.
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';

import { HttpDispatcher } from '../http-dispatcher.js';

/** Config keys the fake's `notify` descriptor declares (the #4277 legal set). */
const NOTIFY_DECLARED_CONFIG_KEYS = ['message', 'recipients', 'channel'];

/**
 * The #4277 refusal, reproduced from `service-automation/src/engine.ts`
 * (`validateNodeConfigKeys` + `collectUndeclaredConfigKeys`). Every clause is
 * load-bearing: the key, the node, its type, the prescription, and the declared
 * set an author can choose from.
 */
function undeclaredConfigKeyRefusal(flowName: string, nodeId: string, nodeType: string, key: string): Error {
    const violation =
        `node '${nodeId}' (${nodeType}): unknown config key \`${key}\` at config.${key}` +
        ` It is not declared by this node type's configSchema, so nothing reads it.` +
        ` Declared here: ${NOTIFY_DECLARED_CONFIG_KEYS.join(', ')}.`;
    return new Error(
        `Flow '${flowName}' rejected: 1 undeclared config key(s) (#4277).\n` +
        `  - ${violation}\n` +
        `An undeclared key is never read, so it can only be a typo or dead config — fix the ` +
        `flow's metadata (rename or remove the key). If an executor genuinely reads this key, ` +
        `declare it on the node type's descriptor configSchema instead; read-but-undeclared ` +
        `keys are exactly the drift the #4045 reconciliation closed.`,
    );
}

/**
 * An automation service that refuses the same definitions the real engine
 * refuses, in the same order `AutomationEngine.registerFlow` runs them:
 * schema parse → control-flow regions → #4277 undeclared config keys.
 *
 * Modelling the THROW is the point. A fake that quietly accepted every body
 * would pass whether or not the handler classifies anything.
 */
function makeDispatcher(options?: { registerFlow?: (name: string, definition: unknown) => void }) {
    const registered = new Map<string, unknown>();
    const flows = new Map<string, unknown>([['already_there', { name: 'already_there' }]]);

    const spies = {
        registerFlow: vi.fn(options?.registerFlow ?? ((name: string, definition: unknown) => {
            const parsed = FlowSchema.parse(definition) as { nodes?: Array<Record<string, any>> };
            validateControlFlow(parsed as any);
            for (const node of parsed.nodes ?? []) {
                if (node.type !== 'notify') continue;
                for (const key of Object.keys(node.config ?? {})) {
                    if (!NOTIFY_DECLARED_CONFIG_KEYS.includes(key)) {
                        throw undeclaredConfigKeyRefusal(String((definition as any)?.name), node.id, node.type, key);
                    }
                }
            }
            registered.set(name, parsed);
            flows.set(name, parsed);
        })),
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        toggleFlow: vi.fn(async (name: string) => {
            if (!flows.has(name)) throw new Error(`Flow '${name}' not found`);
        }),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies, registered };
}

/**
 * [#10145] The caller carries `manage_metadata` — the ADR-0066 D1 authoring
 * capability the `/automation` definition writes (`POST /`, `PUT /:name`,
 * `DELETE /:name`) now demand, the same gate the sibling `/meta` and
 * `/packages` writes already carry.
 *
 * The cases below are about the ERROR CLASS a rejected definition is served as
 * (400 vs 500) and the unknown-flow 404. They were written when any
 * authenticated session could register a flow, i.e. their `{ userId: 'user_1' }`
 * stub encoded exactly the premise the gate destroys, so without a capability
 * they would now stop at the 403 before reaching the behaviour each one is named
 * after. Only the CALLER changes here; every mechanism, assertion and expected
 * value is untouched. The gate itself is pinned in
 * `automation-write-capability-gate.test.ts`.
 */
const CTX = { request: {}, executionContext: { userId: 'user_1', systemPermissions: ['manage_metadata'] } } as any;

/** A definition that is legal at every gate the fake runs. */
const WELL_FORMED = {
    name: 'welcome_flow',
    label: 'Welcome',
    type: 'autolaunched',
    nodes: [{ id: 'n', type: 'notify', label: 'Notify', config: { message: 'hi' } }],
    edges: [],
};

/** The four bodies from the issue, each one letter away from `WELL_FORMED`. */
const BAD_BODIES = {
    /** 1 — a node with no `label`. */
    missingNodeLabel: {
        ...WELL_FORMED,
        nodes: [{ id: 'n', type: 'notify', config: { message: 'hi' } }],
    },
    /** 2 — a node key the schema does not declare. */
    unknownNodeKey: {
        ...WELL_FORMED,
        nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }],
    },
    /** 3 — a `try_catch` whose `try` region is an array, not a region object. */
    malformedRegion: {
        ...WELL_FORMED,
        nodes: [{
            id: 'g', type: 'try_catch', label: 'Guard',
            config: { try: [], catch: { nodes: [], edges: [] } },
        }],
    },
    /** 4 — a config key the node type's descriptor does not declare (#4277). */
    undeclaredConfigKey: {
        ...WELL_FORMED,
        nodes: [{
            id: 'n', type: 'notify', label: 'Notify',
            config: { message: 'hi', totallyBogusKey: 'oops' },
        }],
    },
} as const;

function postFlow(dispatcher: HttpDispatcher, body: unknown) {
    return dispatcher.handleAutomation('', 'POST', body, CTX);
}

/**
 * The whole house envelope for a caller-input refusal — ADR-0112's `code` AND
 * `status`, plus an ADR-0114 `fields[]` whose entries have the declared shape.
 * Returned so a case can go on to assert its own substance.
 */
async function expectValidationEnvelope(body: unknown, label: string) {
    const { dispatcher, spies } = makeDispatcher();
    const result: any = await postFlow(dispatcher, body);
    const res = result.response;

    expect(result.handled, label).toBe(true);
    // The class — the defect itself.
    expect(res?.status, `${label}: HTTP status`).toBe(400);
    expect(res?.body?.success, label).toBe(false);
    // ADR-0112: a SEMANTIC code, never the number, mirrored onto the body.
    expect(res?.body?.error?.code, `${label}: error.code`).toBe('VALIDATION_FAILED');
    expect(res?.body?.error?.httpStatus, label).toBe(400);

    // ADR-0114: `fields`, not `fieldErrors`, and every entry carries the
    // declared triple. An empty array would be a 400 that names nothing.
    const fields = res?.body?.error?.details?.fields;
    expect(Array.isArray(fields), `${label}: details.fields must be an array`).toBe(true);
    expect(fields.length, `${label}: details.fields must not be empty`).toBeGreaterThan(0);
    for (const f of fields) {
        expect(typeof f.field, `${label}: fields[].field`).toBe('string');
        expect(typeof f.code, `${label}: fields[].code`).toBe('string');
        expect(typeof f.message, `${label}: fields[].message`).toBe('string');
    }

    // A refusal is not a fault: nothing generic replaced the located answer.
    expect(res?.body?.error?.message, label).not.toBe('Internal server error');

    // The engine was still ASKED — this is a classification of its verdict, not
    // a new pre-check that changed which bodies reach it.
    expect(spies.registerFlow, `${label}: the engine must still be consulted`).toHaveBeenCalled();

    return { res, fields, spies };
}

describe('#8055 — a malformed flow definition is 400 VALIDATION_FAILED, not 500', () => {
    it('case 1 — a node missing `label`: the raw Zod issue array never reaches the wire', async () => {
        const { res, fields } = await expectValidationEnvelope(BAD_BODIES.missingNodeLabel, 'missing node label');

        // The POSITIVE shape, not merely "something changed": `details` is the
        // house envelope's `fields` and nothing else. Before the fix this
        // position held Zod's own `issues` array verbatim.
        expect(Object.keys(res.body.error.details)).toEqual(['fields']);
        expect(res.body.error.details.issues).toBeUndefined();
        for (const f of fields) {
            expect(Object.keys(f).sort()).toEqual(['code', 'field', 'message']);
        }

        // No Zod-internal KEY survives anywhere in the response. Quoted, so the
        // words "expected"/"received" inside Zod's human message do not match.
        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('"expected"');
        expect(wire).not.toContain('"received"');
        expect(wire).not.toContain('"path"');

        // The located fault is kept — the thing the raw array was carrying.
        expect(fields.map((f: any) => f.field)).toContain('nodes.0.label');
        expect(res.body.error.message).toContain('nodes.0.label');
    });

    it('case 2 — an unknown node key: located, named, and free of Zod internals', async () => {
        const { res, fields } = await expectValidationEnvelope(BAD_BODIES.unknownNodeKey, 'unknown node key');

        // `{code:'unrecognized_keys', keys:['next'], path:['nodes',0]}` was the
        // 500's payload. The offending key must still be NAMED — a 400 that
        // says only "invalid body" is a worse answer than the 500 it replaced.
        expect(fields.map((f: any) => f.field)).toContain('nodes.0');
        expect(fields.some((f: any) => f.message.includes('next'))).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain('"keys"');
    });

    it('case 3 — a malformed `try_catch` region: the engine\'s own sentence survives', async () => {
        const { res, fields } = await expectValidationEnvelope(BAD_BODIES.malformedRegion, 'malformed try_catch');

        // Produced by the real `validateControlFlow`, byte-identical to the
        // text the issue reported under a 500.
        expect(res.body.error.message).toContain("try_catch 'g' try: invalid region");
        expect(res.body.error.message).toContain('Invalid input: expected object, received array');
        // A refusal with no Zod path to point at addresses the body root and
        // takes the ADR-0114 catalog's "no other member names this".
        expect(fields).toEqual([
            { field: '(body)', code: 'invalid_value', message: res.body.error.message },
        ]);
    });

    it('case 4 — the #4277 self-correcting text arrives INTACT under the honest status', async () => {
        const { res, fields } = await expectValidationEnvelope(
            BAD_BODIES.undeclaredConfigKey, 'undeclared config key',
        );

        // The whole point of the fix: reclassifying must not flatten the
        // message. Every clause an authoring agent needs to correct itself:
        const message: string = res.body.error.message;
        expect(message).toContain('#4277');
        expect(message).toContain('unknown config key `totallyBogusKey`');
        expect(message).toContain('at config.totallyBogusKey');
        expect(message).toContain("not declared by this node type's configSchema");
        // The prescription — WHICH keys the author may use instead.
        expect(message).toContain(`Declared here: ${NOTIFY_DECLARED_CONFIG_KEYS.join(', ')}.`);
        expect(message).toContain("node 'n' (notify)");
        // …and the same substance reaches the field entry, not a stub.
        expect(fields).toHaveLength(1);
        expect(fields[0]).toEqual({ field: '(body)', code: 'invalid_value', message });
    });

    it('no malformed body reaches 500 by any route — no retry-on-5xx client is provoked', async () => {
        for (const [label, body] of Object.entries(BAD_BODIES)) {
            const { dispatcher } = makeDispatcher();
            const result: any = await postFlow(dispatcher, body);
            expect(result.response?.status, label).toBe(400);
            expect(result.response?.body?.error?.code, label).toBe('VALIDATION_FAILED');
        }
    });

    it('an engine error that DECLARES its own class keeps it — the boundary supplies a default, not a verdict', async () => {
        // Nothing in the engine carries a `.status` today, which is exactly why
        // every refusal above defaults to 400. This seam is what keeps a future
        // "the flow store is unreachable" (a real 503) from being answered as
        // the author's fault, and it is the same precedence `errorFromThrown`
        // already applies to a thrown `.status`.
        const { dispatcher } = makeDispatcher({
            registerFlow: () => {
                throw Object.assign(new Error('flow store unreachable'), { status: 503 });
            },
        });

        const result: any = await postFlow(dispatcher, WELL_FORMED);
        expect(result.response?.status).toBe(503);
        expect(result.response?.body?.error?.message).toBe('flow store unreachable');
    });
});

// ---------------------------------------------------------------------------
// Contrast controls — the refusal must not have WIDENED
// ---------------------------------------------------------------------------

describe('#8055 — what must not change', () => {
    it('a well-formed body still registers, 200, and still reaches the service', async () => {
        const { dispatcher, spies, registered } = makeDispatcher();

        const result: any = await postFlow(dispatcher, WELL_FORMED);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.success).toBe(true);
        expect(spies.registerFlow).toHaveBeenCalledWith('welcome_flow', WELL_FORMED);
        expect(registered.has('welcome_flow')).toBe(true);
        // The definition is echoed back unchanged, as it always was.
        expect(result.response?.body?.data ?? result.response?.body).toMatchObject({ name: 'welcome_flow' });
    });

    it('the #3899 body checks still refuse BEFORE the engine is asked', async () => {
        // A definition with no usable `name` must never reach `registerFlow` —
        // it would register under the key `undefined`. That refusal is thrown,
        // not returned, and this change must not have swallowed it into the new
        // catch arm.
        const { dispatcher, spies } = makeDispatcher();

        await expect(postFlow(dispatcher, { label: 'x', type: 'autolaunched', nodes: [], edges: [] }))
            .rejects.toThrow();
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('the unknown-flow toggle still answers 404 RESOURCE_NOT_FOUND (#7535)', async () => {
        // The sibling route this card's fix was modelled on. Its class must not
        // have been dragged to 400 by a change that reaches for "everything on
        // this domain is the caller's fault".
        const { dispatcher } = makeDispatcher();

        const result: any = await dispatcher.handleAutomation('/definitely_not_a_flow/toggle', 'POST', { enabled: false }, CTX);

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain('definitely_not_a_flow');
    });
});
