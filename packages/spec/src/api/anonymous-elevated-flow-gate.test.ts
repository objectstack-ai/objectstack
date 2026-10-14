// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D2b — the anonymous door × elevated flow publish refusal, the spec
 * half: the one cross-item judge (`anonymousElevatedFlowPairs`) and the stack
 * parse's leg (`applyApiEndpointGates` → `validateAnonymousElevatedFlows`).
 *
 * The record: "Publish refuses an `authRequired: false` endpoint of
 * `type: 'flow'` whose target flow declares `runAs: 'system'`, in both
 * directions, because either item can be the last one edited." At the stack
 * door both items are in one input, so each direction is pinned as the edit
 * that completes the pair from an ACCEPTED stack: an endpoint flipped to
 * anonymous while its flow runs as `system`, and a flow flipped to `system`
 * while an anonymous endpoint names it. Each starting stack is the negative
 * control of its direction, and each refusal is asserted on its envelope (the
 * issue's `code` and `path` at the parse, `code` + `status` at `defineStack`)
 * and on the prescription it carries.
 *
 * The metadata layer's two doors are pinned in their own packages:
 * `publish-anonymous-elevated-flow-gate.test.ts` (`@objectstack/metadata`,
 * package publish) and `protocol.item-name-every-door.test.ts` section 5
 * (`@objectstack/metadata-protocol`, flow publish).
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import {
    anonymousElevatedFlowPairs,
    anonymousEndpointElevatedFlowMessage,
    anonymousFlowDoorTarget,
    elevatedFlowAnonymousEndpointsMessage,
    validateAnonymousElevatedFlows,
} from './endpoint-publish-gate';

const manifest = {
    id: 'com.example.d2b',
    name: 'd2b-test',
    version: '1.0.0',
    type: 'app' as const,
    namespace: 'showcase',
};

/** ADR-0121 D6: an anonymous endpoint publishes only with an armed budget. */
const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 100 };

const FLOW = 'showcase_partner_intake';

/** A `type: 'api'` flow — the shape the runtime's elevated-start refusal does NOT cover. */
const flow = (runAs?: 'system' | 'user') => ({
    name: FLOW,
    label: 'Partner intake',
    type: 'api' as const,
    ...(runAs !== undefined ? { runAs } : {}),
    nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        { id: 'end', type: 'end' as const, label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A flow endpoint naming {@link FLOW}; anonymous endpoints arm their budget. */
const endpoint = (authRequired: boolean, over: Record<string, unknown> = {}) => ({
    name: 'showcase_partner_intake_api',
    path: '/api/v1/apps/showcase/partner/intake',
    method: 'POST' as const,
    type: 'flow' as const,
    target: FLOW,
    authRequired,
    ...(authRequired ? {} : { rateLimit: ARMED }),
    ...over,
});

const stack = (apis: unknown[], flows: unknown[]) => ({ manifest, apis, flows });

/** The issues the real seam raises, or `[]` when the stack parses clean. */
function issuesOf(input: Record<string, unknown>) {
    const result = ObjectStackDefinitionSchema.safeParse(input);
    return result.success ? [] : result.error.issues;
}

/** The record's prescription, scenario by scenario — each serving channel named. */
function expectPrescription(message: string) {
    expect(message).toContain('authenticated endpoint');
    expect(message).toContain('signed inbound hook (ADR-0041)');
    expect(message).toContain('public form');
    expect(message).toContain('ADR-0138 D2b');
    // ⛔ Not prescribed until ADR-0073 M2 adds it to the enum: an author
    // following it today would write a value the schema refuses.
    expect(message).not.toContain("'automation'");
}

describe('ADR-0138 D2b — the stack parse refuses the pair, whichever item completes it', () => {
    it('control: an AUTHENTICATED endpoint on a `system` flow publishes', () => {
        expect(issuesOf(stack([endpoint(true)], [flow('system')]))).toEqual([]);
    });

    it('control: an ANONYMOUS endpoint on a `user` flow publishes, and on a flow that leaves `runAs` at its default', () => {
        expect(issuesOf(stack([endpoint(false)], [flow('user')]))).toEqual([]);
        expect(issuesOf(stack([endpoint(false)], [flow()]))).toEqual([]);
    });

    it('endpoint direction: flipping the endpoint to `authRequired: false` while its flow runs as `system` is refused at the endpoint', () => {
        const issues = issuesOf(stack([endpoint(false)], [flow('system')]));
        expect(issues).toHaveLength(1);
        expect(issues[0]!.code).toBe('custom');
        expect(issues[0]!.path).toEqual(['apis', 0, 'authRequired']);
        expect(issues[0]!.message).toContain("Endpoint 'showcase_partner_intake_api'");
        expect(issues[0]!.message).toContain(`flow '${FLOW}'`);
        expectPrescription(issues[0]!.message);
    });

    it("flow direction: flipping the flow to `runAs: 'system'` while an anonymous endpoint names it is refused, the same issue", () => {
        const before = issuesOf(stack([endpoint(false)], [flow('user')]));
        expect(before).toEqual([]);
        const after = issuesOf(stack([endpoint(false)], [flow('system')]));
        expect(after.map((i) => ({ code: i.code, path: i.path }))).toEqual([
            { code: 'custom', path: ['apis', 0, 'authRequired'] },
        ]);
    });

    it('defineStack refuses it in the stack envelope: STACK_SCHEMA_INVALID, 422, the issue located at the endpoint', () => {
        let thrown: any;
        try {
            defineStack(stack([endpoint(false)], [flow('system')]) as any);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.code).toBe('STACK_SCHEMA_INVALID');
        expect(thrown.status).toBe(422);
        expect(thrown.issues.map((i: any) => i.path)).toContainEqual(['apis', 0, 'authRequired']);
    });

    it('one issue per anonymous endpoint naming the flow; an authenticated sibling on the same flow is not reported', () => {
        const issues = issuesOf(stack(
            [
                endpoint(false),
                endpoint(true, { name: 'showcase_partner_intake_signed', path: '/api/v1/apps/showcase/partner/signed' }),
                endpoint(false, { name: 'showcase_partner_intake_two', path: '/api/v1/apps/showcase/partner/two' }),
            ],
            [flow('system')],
        ));
        expect(issues.map((i) => i.path)).toEqual([
            ['apis', 0, 'authRequired'],
            ['apis', 2, 'authRequired'],
        ]);
    });

    it('an anonymous endpoint that also lacks its armed budget is reported for both (D2b is not a cascade of D6)', () => {
        const { rateLimit: _armed, ...unmetered } = endpoint(false);
        const issues = issuesOf(stack([unmetered], [flow('system')]));
        expect(issues.map((i) => i.path)).toEqual([
            ['apis', 0, 'authRequired'],
            ['apis', 0, 'rateLimit'],
        ]);
    });
});

describe('ADR-0138 D2b — the judge reads only the pair', () => {
    it('an anonymous `object_operation` endpoint is not a flow door, whatever flow shares its name', () => {
        expect(anonymousFlowDoorTarget({ type: 'object_operation', authRequired: false, target: FLOW })).toBeUndefined();
        expect(issuesOf(stack(
            [{
                name: 'showcase_feed',
                path: '/api/v1/apps/showcase/feed',
                method: 'GET',
                type: 'object_operation',
                objectParams: { object: 'showcase_task', operation: 'find' },
                target: FLOW,
                authRequired: false,
                rateLimit: ARMED,
            }],
            [flow('system')],
        ))).toEqual([]);
    });

    it('an endpoint whose `authRequired` is absent is not anonymous (the schema default is true)', () => {
        expect(anonymousFlowDoorTarget({ type: 'flow', target: FLOW })).toBeUndefined();
        expect(anonymousElevatedFlowPairs([{ name: 'e', type: 'flow', target: FLOW }], [{ name: FLOW, runAs: 'system' }]))
            .toEqual([]);
    });

    it('a `system` flow of another name is not paired', () => {
        expect(anonymousElevatedFlowPairs(
            [{ name: 'e', type: 'flow', authRequired: false, target: FLOW }],
            [{ name: 'showcase_other', runAs: 'system' }],
        )).toEqual([]);
    });

    it('returns the pair with both indexes and names, in endpoint order', () => {
        expect(anonymousElevatedFlowPairs(
            [
                { name: 'a', type: 'flow', authRequired: false, target: 'f2' },
                { type: 'flow', authRequired: false, target: 'f1' },
            ],
            [{ name: 'f1', runAs: 'system' }, { name: 'f2', runAs: 'system' }, { name: 'f3', runAs: 'user' }],
        )).toEqual([
            { endpointIndex: 0, endpoint: 'a', flowIndex: 1, flow: 'f2' },
            { endpointIndex: 1, endpoint: 'apis[1]', flowIndex: 0, flow: 'f1' },
        ]);
    });

    it('validateAnonymousElevatedFlows is empty without both halves', () => {
        expect(validateAnonymousElevatedFlows(undefined, [{ name: FLOW, runAs: 'system' }])).toEqual([]);
        expect(validateAnonymousElevatedFlows([endpoint(false)], undefined)).toEqual([]);
    });
});

describe('ADR-0138 D2b — each direction\'s refusal carries the prescription', () => {
    it('the endpoint direction names the endpoint, the flow and every serving channel', () => {
        const message = anonymousEndpointElevatedFlowMessage('e_pub', 'f_sys');
        expect(message).toContain("Endpoint 'e_pub'");
        expect(message).toContain("flow 'f_sys'");
        expectPrescription(message);
    });

    it('the flow direction names the flow and every anonymous endpoint that triggers it', () => {
        const one = elevatedFlowAnonymousEndpointsMessage('f_sys', ['e_one']);
        expect(one).toContain("Flow 'f_sys'");
        expect(one).toContain("'e_one'");
        expectPrescription(one);
        const three = elevatedFlowAnonymousEndpointsMessage('f_sys', ['e1', 'e2', 'e3']);
        for (const name of ['e1', 'e2', 'e3']) expect(three).toContain(`'${name}'`);
    });
});
