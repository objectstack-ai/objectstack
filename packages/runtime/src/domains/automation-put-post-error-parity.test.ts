// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8123 — `POST /api/v1/automation` and `PUT /api/v1/automation/:name` must
 * answer the SAME class for the SAME malformed flow definition.
 *
 * #8055 fixed the class on `POST /` alone: a refusal thrown by
 * `automationService.registerFlow` used to escape as a 500 `INTERNAL_ERROR`,
 * and is now caught and reclassified through the module-local, route-agnostic
 * `flowDefinitionRefusal` helper into a 400 `VALIDATION_FAILED` with an
 * ADR-0114 `details.fields[]`. `PUT /:name` makes the identical
 * `registerFlow` call in the same file and, until this card, had no
 * classification around it at all — so the two doors disagreed about the
 * class of an identical refusal, the exact drift #7535's fix on the sibling
 * `/toggle` route was shaped to avoid ("the two routes cannot disagree").
 *
 * ## Why a per-route pin is not the bar
 *
 * A suite that only asserts `PUT` in isolation (as `automation-register-
 * error-class.test.ts` does for `POST`) would have stayed green through the
 * exact bug this card fixes: `PUT` was individually "consistent" with its own
 * (wrong) 500 the whole time. The pin that actually closes the drift has to
 * DRIVE BOTH DOORS with the same body and COMPARE the two responses, so that
 * reverting either door's classification — not just PUT's — reddens this
 * file. See the reverse-verification note in the PR description for the
 * measured failure text.
 *
 * ## The fake
 *
 * Same fake as `automation-register-error-class.test.ts` (#8055): three of
 * the four cases run the REAL `FlowSchema.parse` / `validateControlFlow` from
 * `@objectstack/spec/automation` — the very calls
 * `AutomationEngine.canonicalizeStoredFlow` makes — and the fourth
 * (#4277's undeclared config key) is reproduced from the engine's own
 * construction, because that check lives in `@objectstack/service-automation`
 * which `@objectstack/runtime` does not depend on. Duplicated here rather
 * than imported from that file: each domain test file in this package
 * constructs its own fake dispatcher, and importing test fixtures across
 * suites is not the existing convention.
 */

import { describe, it, expect } from 'vitest';
import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';

import { HttpDispatcher } from '../http-dispatcher.js';

/** Config keys the fake's `notify` descriptor declares (the #4277 legal set). */
const NOTIFY_DECLARED_CONFIG_KEYS = ['message', 'recipients', 'channel'];

/**
 * The #4277 refusal, reproduced from `service-automation/src/engine.ts`
 * (`validateNodeConfigKeys` + `collectUndeclaredConfigKeys`) — see
 * `automation-register-error-class.test.ts` for the full derivation note.
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
 * A fresh dispatcher per call, backed by an automation service that refuses
 * the same definitions the real engine refuses, in the same order
 * `AutomationEngine.registerFlow` runs them: schema parse → control-flow
 * regions → #4277 undeclared config keys. One instance per call so a POST
 * probe and a PUT probe never share call-count state.
 */
function makeDispatcher() {
    const registered = new Map<string, unknown>();

    const spies = {
        registerFlow: (name: string, definition: unknown) => {
            // Recorded before any gate runs — "the engine was consulted" must
            // hold whether the call ends in a refusal or a registration.
            calls.push(name);
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
        },
        getFlow: async (name: string) => registered.get(name) ?? null,
    };
    const calls: string[] = [];
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), registered, calls };
}

/**
 * [#10145] The caller carries `manage_metadata` — the ADR-0066 D1 authoring
 * capability the `/automation` definition writes (`POST /`, `PUT /:name`,
 * `DELETE /:name`) now demand, the same gate the sibling `/meta` and
 * `/packages` writes already carry.
 *
 * The cases below are about PARITY between the POST and PUT doors — that an
 * identical refusal is classified identically whichever door it arrives at. They were written when any
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

/** The four bodies from #8055 / #8123, each one letter away from `WELL_FORMED`. */
const BAD_BODIES = {
    /** 1 — a node with no `label` (`FlowSchema.parse`). */
    missingNodeLabel: {
        ...WELL_FORMED,
        nodes: [{ id: 'n', type: 'notify', config: { message: 'hi' } }],
    },
    /** 2 — a node key the schema does not declare (`unrecognized_keys`). */
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

function putFlow(dispatcher: HttpDispatcher, name: string, body: unknown) {
    return dispatcher.handleAutomation(`/${name}`, 'PUT', body, CTX);
}

/**
 * The whole house envelope for a caller-input refusal — ADR-0112's `code` AND
 * `status`, plus an ADR-0114 `fields[]` whose entries have the declared
 * shape. Applied to EACH door independently (so a shared regression, e.g.
 * both doors going back to 500, is still caught) as well as by direct
 * comparison below (so a ONE-SIDED regression is caught too).
 */
function assertValidationEnvelope(res: any, label: string) {
    expect(res?.status, `${label}: HTTP status`).toBe(400);
    expect(res?.body?.success, label).toBe(false);
    expect(res?.body?.error?.code, `${label}: error.code`).toBe('VALIDATION_FAILED');
    expect(res?.body?.error?.httpStatus, label).toBe(400);

    const fields = res?.body?.error?.details?.fields;
    expect(Array.isArray(fields), `${label}: details.fields must be an array`).toBe(true);
    expect(fields.length, `${label}: details.fields must not be empty`).toBeGreaterThan(0);
    for (const f of fields) {
        expect(typeof f.field, `${label}: fields[].field`).toBe('string');
        expect(typeof f.code, `${label}: fields[].code`).toBe('string');
        expect(typeof f.message, `${label}: fields[].message`).toBe('string');
    }
    expect(res?.body?.error?.message, label).not.toBe('Internal server error');
    return fields;
}

describe('#8123 — POST and PUT agree on the class of an identical flow refusal', () => {
    it.each(Object.entries(BAD_BODIES))(
        'case "%s": POST and PUT answer the SAME envelope for the identical body',
        async (label, body) => {
            const post = makeDispatcher();
            const postResult: any = await postFlow(post.dispatcher, body);

            const put = makeDispatcher();
            const putResult: any = await putFlow(put.dispatcher, (body as any).name, body);

            // Each door independently: the whole envelope, not just "not 500".
            const postFields = assertValidationEnvelope(postResult.response, `POST ${label}`);
            const putFields = assertValidationEnvelope(putResult.response, `PUT ${label}`);

            // THE PIN: the two doors compared directly, for the SAME body.
            // A per-route assertion above would already have caught #8123
            // (PUT still 500) — this comparison is what keeps them from
            // drifting apart again in either direction, on any future change
            // to either branch.
            expect(putResult.response.status, `${label}: status parity`).toBe(postResult.response.status);
            expect(putResult.response.body.error.code, `${label}: code parity`).toBe(postResult.response.body.error.code);
            expect(putFields, `${label}: fields parity`).toEqual(postFields);
            expect(putResult.response.body.error.message, `${label}: message parity`)
                .toBe(postResult.response.body.error.message);

            // The engine was still ASKED on both doors — a classification of
            // its verdict, not a new pre-check that changed which bodies
            // reach it.
            expect(post.calls, `${label}: POST must still consult the engine`).toContain((body as any).name);
            expect(put.calls, `${label}: PUT must still consult the engine`).toContain((body as any).name);
        },
    );

    it('case "undeclaredConfigKey" (#4277): the self-correcting message survives verbatim on PUT', async () => {
        const { dispatcher } = makeDispatcher();
        const body = BAD_BODIES.undeclaredConfigKey;
        const result: any = await putFlow(dispatcher, body.name, body);

        const message: string = result.response.body.error.message;
        expect(message).toContain('#4277');
        expect(message).toContain('unknown config key `totallyBogusKey`');
        expect(message).toContain('at config.totallyBogusKey');
        expect(message).toContain("not declared by this node type's configSchema");
        expect(message).toContain(`Declared here: ${NOTIFY_DECLARED_CONFIG_KEYS.join(', ')}.`);
        expect(message).toContain("node 'n' (notify)");
        // …and the same substance reaches the field entry, not a stub.
        const fields = result.response.body.error.details.fields;
        expect(fields).toHaveLength(1);
        expect(fields[0]).toEqual({ field: '(body)', code: 'invalid_value', message });
    });

    it('case "missingNodeLabel": the raw Zod issue array does not reach the wire on PUT either', async () => {
        const { dispatcher } = makeDispatcher();
        const body = BAD_BODIES.missingNodeLabel;
        const result: any = await putFlow(dispatcher, body.name, body);

        expect(Object.keys(result.response.body.error.details)).toEqual(['fields']);
        expect(result.response.body.error.details.issues).toBeUndefined();
        const wire = JSON.stringify(result.response.body);
        expect(wire).not.toContain('"expected"');
        expect(wire).not.toContain('"received"');
        expect(wire).not.toContain('"path"');
    });

    it('the PUT-only { definition } wrapper still reaches the SAME classification as the bare form', async () => {
        // [#8123] Noted on the issue: PUT has its own `body.definition ?? body`
        // unwrap, so the definition it forwards to `registerFlow` is not
        // always the request body verbatim. Both dialects must classify the
        // same way.
        const bareRun = makeDispatcher();
        const body = BAD_BODIES.undeclaredConfigKey;
        const bare: any = await putFlow(bareRun.dispatcher, body.name, body);

        const wrappedRun = makeDispatcher();
        const wrapped: any = await wrappedRun.dispatcher.handleAutomation(`/${body.name}`, 'PUT', { definition: body }, CTX);

        expect(wrapped.response.status).toBe(bare.response.status);
        expect(wrapped.response.body.error.code).toBe(bare.response.body.error.code);
        expect(wrapped.response.body.error.message).toBe(bare.response.body.error.message);
        assertValidationEnvelope(wrapped.response, 'PUT { definition } wrapper');
    });
});

// ---------------------------------------------------------------------------
// Contrast controls — neither door may have WIDENED or NARROWED which bodies
// are refused; only the class and envelope on PUT may have changed.
// ---------------------------------------------------------------------------

describe('#8123 — what must not change', () => {
    it('a well-formed body still registers, 200, on BOTH doors', async () => {
        const post = makeDispatcher();
        const postResult: any = await postFlow(post.dispatcher, WELL_FORMED);
        expect(postResult.response?.status).toBe(200);
        expect(postResult.response?.body?.success).toBe(true);
        expect(post.registered.has('welcome_flow')).toBe(true);

        const put = makeDispatcher();
        const putResult: any = await putFlow(put.dispatcher, WELL_FORMED.name, WELL_FORMED);
        expect(putResult.response?.status).toBe(200);
        expect(putResult.response?.body?.success).toBe(true);
        expect(put.registered.has('welcome_flow')).toBe(true);
    });

    it('every bad body is still refused on PUT — never 200 — only the class changed from 500', async () => {
        for (const [label, body] of Object.entries(BAD_BODIES)) {
            const { dispatcher } = makeDispatcher();
            const result: any = await putFlow(dispatcher, (body as any).name, body);
            expect(result.response?.status, label).not.toBe(200);
            expect(result.response?.status, label).toBe(400);
            expect(result.response?.body?.error?.code, label).toBe('VALIDATION_FAILED');
        }
    });

    it('an engine error on PUT that DECLARES its own class keeps it (same seam as POST)', async () => {
        // A service whose `registerFlow` declares its own `.status` — the
        // producer's escape hatch `flowDefinitionRefusal` already honours.
        const throwing = {
            registerFlow: () => {
                throw Object.assign(new Error('flow store unreachable'), { status: 503 });
            },
        };
        const services: Record<string, unknown> = { automation: throwing };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
        const d = new HttpDispatcher(kernel);

        const result: any = await putFlow(d, 'welcome_flow', WELL_FORMED);
        expect(result.response?.status).toBe(503);
        expect(result.response?.body?.error?.message).toBe('flow store unreachable');
    });
});
