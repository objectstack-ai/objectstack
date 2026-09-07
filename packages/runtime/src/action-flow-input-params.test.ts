// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `list_actions` publishes a FLOW action's input names (#15705).
 *
 * The MCP `list_actions` tool description promises each action's "input
 * parameters", and `summarizeActionParams` delivered them by iterating
 * `action.params` — the script-action declaration. A flow-typed action almost
 * never declares `params`: its input contract is the target flow's `isInput`
 * variables, which is what `seedDeclaredVariables` binds the caller's bag into.
 * So every flow action listed with no `params` key at all, and an agent could
 * see the action, could invoke it, and had no way to learn a single input name
 * — the reported reproduction passed `due_date` where the flow declares
 * `dueDate` because guessing was the only move available.
 *
 * Pinned here:
 *
 *  1. the inputs are published, in declaration order, with the collecting
 *     screen field's `label` / `type` / `required` / `options` folded in;
 *  2. a variable that is NOT `isInput` stays private — the listing publishes an
 *     input contract, not the flow's internals;
 *  3. an author's own `action.params` still WINS, so this can only fill a
 *     silence and no existing listing changes shape;
 *  4. every absence is inert: no flow, a flow with no variables, a non-flow
 *     action — all answer exactly as they did before.
 *
 * `required` is read off the screen field alone. A flow variable has no
 * `required` key, and inferring one from "declares no `defaultValue`" would
 * invent a contract the author never wrote — the same reason the executor's
 * satisfaction verdict one package over reads `required` from the field spec.
 */

import { describe, it, expect } from 'vitest';

import {
    summarizeAction,
    summarizeActionParams,
    summarizeFlowInputParams,
} from './action-execution.js';

const NO_DEPS: any = {};

/** The card's specimen: `schedule_followup`, `type: 'flow'`, no declared params. */
const FLOW_ACTION = {
    name: 'schedule_followup',
    label: 'Schedule Follow-up',
    type: 'flow',
    target: 'schedule_followup',
    ai: { exposed: true },
    locations: ['record_header'],
};

/**
 * The target flow. `internal_cursor` is deliberately not an input, and
 * `activityType` is collected on a SECOND screen — a wizard's later step is
 * still part of the input contract.
 */
const FLOW = {
    name: 'schedule_followup',
    type: 'screen',
    variables: [
        { name: 'subject', type: 'text', isInput: true },
        { name: 'dueDate', type: 'text', isInput: true },
        { name: 'activityType', type: 'text', isInput: true },
        { name: 'internal_cursor', type: 'number', isInput: false },
    ],
    nodes: [
        { id: 'start', type: 'start' },
        {
            id: 'screen_1', type: 'screen',
            config: {
                fields: [
                    { name: 'subject', label: 'Subject', type: 'text', required: true },
                    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
                ],
            },
        },
        {
            id: 'screen_2', type: 'screen',
            config: {
                fields: [
                    {
                        name: 'activityType', label: 'Activity type', type: 'select',
                        options: [{ value: 'call', label: 'Call' }, { value: 'email', label: 'Email' }],
                    },
                ],
            },
        },
        { id: 'end', type: 'end' },
    ],
};

describe('summarizeFlowInputParams (#15705)', () => {
    it('publishes every isInput variable, in declaration order, enriched from its screen field', () => {
        expect(summarizeFlowInputParams(NO_DEPS, FLOW)).toEqual([
            { name: 'subject', type: 'string', required: true, description: 'Subject' },
            { name: 'dueDate', type: 'string', required: true, description: 'Due date' },
            {
                name: 'activityType', type: 'string', required: false,
                description: 'Activity type', enum: ['call', 'email'],
            },
        ]);
    });

    it('keeps a non-input variable private', () => {
        const names = summarizeFlowInputParams(NO_DEPS, FLOW).map((p) => p.name);
        expect(names).not.toContain('internal_cursor');
    });

    it('lists an input no screen collects — without the screen-only enrichments', () => {
        const flow = { ...FLOW, variables: [{ name: 'silent', type: 'number', isInput: true }] };
        expect(summarizeFlowInputParams(NO_DEPS, flow)).toEqual([
            { name: 'silent', type: 'number', required: false },
        ]);
    });

    it('is inert on every absence', () => {
        expect(summarizeFlowInputParams(NO_DEPS, undefined)).toEqual([]);
        expect(summarizeFlowInputParams(NO_DEPS, {})).toEqual([]);
        expect(summarizeFlowInputParams(NO_DEPS, { variables: [] })).toEqual([]);
        expect(summarizeFlowInputParams(NO_DEPS, { variables: [{ name: 'x', isInput: false }] })).toEqual([]);
    });
});

describe('summarizeActionParams / summarizeAction fall back to the flow (#15705)', () => {
    it('CONTROL — the reported shape: no flow resolved, no params key, exactly as before', () => {
        expect(summarizeActionParams(NO_DEPS, FLOW_ACTION, undefined)).toEqual([]);
        expect(summarizeAction(NO_DEPS, FLOW_ACTION, undefined, 'crm_lead')).not.toHaveProperty('params');
    });

    it('surfaces the flow inputs once the flow is resolved', () => {
        const summary = summarizeAction(NO_DEPS, FLOW_ACTION, undefined, 'crm_lead', FLOW);
        expect(summary.params.map((p: any) => p.name)).toEqual(['subject', 'dueDate', 'activityType']);
        // The rest of the summary is untouched by this change.
        expect(summary).toMatchObject({ name: 'schedule_followup', type: 'flow', requiresRecord: true });
    });

    it("CONTROL — an author's own declared params still win outright", () => {
        const declaring = {
            ...FLOW_ACTION,
            params: [{ name: 'only_this', type: 'text', required: true, label: 'Only this' }],
        };
        const params = summarizeActionParams(NO_DEPS, declaring, undefined, FLOW);
        expect(params.map((p: any) => p.name)).toEqual(['only_this']);
    });

    it('CONTROL — a non-flow action handed a flow is unchanged (the caller resolves none)', () => {
        const script = { name: 'close_case', type: 'script', target: 'closeCase', locations: ['record_header'] };
        expect(summarizeActionParams(NO_DEPS, script, undefined)).toEqual([]);
        expect(summarizeAction(NO_DEPS, script, undefined, 'crm_case')).not.toHaveProperty('params');
    });
});
