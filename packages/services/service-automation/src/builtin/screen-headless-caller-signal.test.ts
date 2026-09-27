// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The screen node's headless verdict reads the door's explicit caller-provenance
 * signal, `AutomationContext.callerParamKeys` (#19846).
 *
 * #15705 let a screen continue when the run's CALLER already answered it, and
 * decided "did the caller supply this field?" by inference over the merged
 * params bag. Each review of that change found a dispatcher seed the previous
 * pass had missed, and the last two constructions it documented still SKIPPED a
 * screen that should pause. Maintainer ruling on #15705 (「15705同意」): the doors
 * that start a flow say which `params` keys the caller supplied, and the
 * executor reads that instead of guessing.
 *
 * ## What this file pins
 *
 *  1. **The two boundary constructions pause.** Both need a non-default
 *     `recordIdField` and a `recordIdParam` naming a key the record lacks, so
 *     the row id reaches the bag under a name no inference leg can refuse. The
 *     contexts below are what `dispatchFlowAction` (`@objectstack/runtime`)
 *     hands the engine for them — the same literals are asserted against the
 *     real door in `packages/runtime/src/flow-caller-param-keys.test.ts`.
 *  2. **Present means "never the inference", in both directions.** The signal
 *     answers a screen the inference would pause (a caller re-sending a
 *     column's own value), and pauses a screen the inference would skip (an
 *     empty list is an answer). A value that is not an array names nothing.
 *  3. **It survives a durable pause**, read after a store round trip.
 *  4. **A `subflow` / `map` child does not inherit the parent's list**, which
 *     describes the parent's bag: the child carries no signal and infers.
 *
 * ⛔ The pins in `screen-headless-satisfaction.test.ts` and
 * `screen-headless-provenance-durable-resume.test.ts` build contexts WITHOUT
 * the signal, so since #19846 they pin the absent path — the inference an
 * older producer still gets — not what the two doors now send.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import { registerScreenNodes } from './screen-nodes.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

type Field = { name: string; label: string; type: string; required?: boolean };

/** `start → screen_1 → end`, the screen collecting `fields`, each an `isInput`/`isOutput` variable. */
function screenFlow(name: string, fields: Field[]) {
    return {
        name, label: name, type: 'screen', status: 'active', version: 1,
        variables: fields.map((f) => ({ name: f.name, type: 'text', isInput: true, isOutput: true })),
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'screen_1', type: 'screen', label: 'Ask', config: { fields } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
            { id: 'e2', source: 'screen_1', target: 'end', type: 'default' },
        ],
    } as any;
}

const SESSION_TOKEN: Field = { name: 'sessionToken', label: 'Session', type: 'text', required: true };

/**
 * Boundary construction 1 — an OBJECT-LESS action (no `object`, so no alias is
 * derivable) whose record carries a column literally named `recordId`, with
 * `recordIdField: 'token'` and `recordIdParam: 'sessionToken'`. The row id is
 * `record.token`; `seedFlowActionParams` seeds it under `sessionToken` only,
 * because the `recordId` column shadows that seed. Every inference candidate
 * (`params.recordId`, `record.id`) reads something else. The caller sent `{}`.
 */
const OBJECT_LESS_RECORD = { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1' };
const OBJECT_LESS_CONTEXT: AutomationContext = {
    record: OBJECT_LESS_RECORD,
    params: { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', sessionToken: 'tok_9' },
    callerParamKeys: [],
};

/**
 * Boundary construction 2 — an OBJECT-BOUND action on `crm_lead` whose record
 * shadows BOTH `recordId` and the `crmLeadId` alias, same `recordIdField` /
 * `recordIdParam`. All three inference candidates read a non-row-id value.
 */
const OBJECT_BOUND_RECORD = { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', crmLeadId: 'shadow_2' };
const OBJECT_BOUND_CONTEXT: AutomationContext = {
    record: OBJECT_BOUND_RECORD,
    object: 'crm_lead',
    params: { id: 'sess_1', token: 'tok_9', recordId: 'shadow_1', crmLeadId: 'shadow_2', sessionToken: 'tok_9' },
    callerParamKeys: [],
};

describe('screen headless verdict reads callerParamKeys (#19846)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
    });

    // ── The two boundary constructions ────────────────────────────────────

    it('BOUNDARY 1 — object-less action, record shadows `recordId`: the screen pauses', async () => {
        engine.registerFlow('ask_session', screenFlow('ask_session', [SESSION_TOKEN]));
        const res = await engine.execute('ask_session', structuredClone(OBJECT_LESS_CONTEXT));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
        // Paused, not answered from the seed: the row id never became the value.
        expect((res.output as Record<string, unknown> | undefined)?.sessionToken).toBeUndefined();
    });

    it('BOUNDARY 2 — object-bound action, record shadows `recordId` and the alias: the screen pauses', async () => {
        engine.registerFlow('ask_session', screenFlow('ask_session', [SESSION_TOKEN]));
        const res = await engine.execute('ask_session', structuredClone(OBJECT_BOUND_CONTEXT));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
        expect((res.output as Record<string, unknown> | undefined)?.sessionToken).toBeUndefined();
    });

    it('the same rig continues when the signal names the screen\'s fields — the pause above is not "everything pauses"', async () => {
        engine.registerFlow('ask_subject', screenFlow('ask_subject', [
            { name: 'subject', label: 'Subject', type: 'text', required: true },
        ]));
        const res = await engine.execute('ask_subject', {
            ...structuredClone(OBJECT_BOUND_CONTEXT),
            params: { ...OBJECT_BOUND_CONTEXT.params, subject: 'Rotate the key' },
            callerParamKeys: ['subject'],
        });
        expect(res.status).not.toBe('paused');
        expect(res.success).toBe(true);
        expect(res.output).toMatchObject({ subject: 'Rotate the key' });
    });

    // ── Present means the signal decides, in both directions ─────────────

    it('answers a screen the inference would pause: a caller re-sending a column\'s own value', async () => {
        engine.registerFlow('ask_company', screenFlow('ask_company', [
            { name: 'company', label: 'Company', type: 'text', required: true },
        ]));
        const lead = { id: 'lead_1', company: 'Acme Inc' };
        // Inferred, `company` equals the record's column and reads as the seed.
        // The door says the caller named it, so it counts.
        const res = await engine.execute('ask_company', {
            record: lead,
            object: 'crm_lead',
            params: { ...lead, recordId: 'lead_1', crmLeadId: 'lead_1', company: 'Acme Inc' },
            callerParamKeys: ['company'],
        });
        expect(res.status).not.toBe('paused');
        expect(res.output).toMatchObject({ company: 'Acme Inc' });
    });

    it('an EMPTY list is an answer: it pauses a screen the inference would skip', async () => {
        engine.registerFlow('ask_subject', screenFlow('ask_subject', [
            { name: 'subject', label: 'Subject', type: 'text', required: true },
        ]));
        // No record at all, so the inference would read `subject` as the
        // caller's. The signal says the caller supplied nothing.
        const res = await engine.execute('ask_subject', {
            object: 'crm_lead',
            params: { subject: 'from somewhere else', recordId: 'lead_1', crmLeadId: 'lead_1' },
            callerParamKeys: [],
        });
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('a present value that is not an array names nothing, so the screen pauses', async () => {
        engine.registerFlow('ask_subject', screenFlow('ask_subject', [
            { name: 'subject', label: 'Subject', type: 'text', required: true },
        ]));
        const res = await engine.execute('ask_subject', {
            object: 'crm_lead',
            params: { subject: 'Call back', recordId: 'lead_1', crmLeadId: 'lead_1' },
            callerParamKeys: 'subject' as unknown as string[],
        });
        expect(res.status).toBe('paused');
    });

    it('a listed key with no value in params does not answer the screen', async () => {
        engine.registerFlow('ask_subject', screenFlow('ask_subject', [
            { name: 'subject', label: 'Subject', type: 'text', required: true },
        ]));
        const res = await engine.execute('ask_subject', {
            object: 'crm_lead',
            params: { recordId: 'lead_1', crmLeadId: 'lead_1' },
            callerParamKeys: ['subject'],
        });
        expect(res.status).toBe('paused');
    });
});

// ── A durable pause ──────────────────────────────────────────────────────

/** Two screens: `collect` pauses (a required field nobody supplied); `review` is the one judged after the resume. */
function twoScreenFlow() {
    return {
        name: 'lead_review', label: 'Lead review', type: 'screen', status: 'active', version: 1,
        variables: [
            { name: 'full_name', type: 'text', isInput: true, isOutput: true },
            { name: 'tags', type: 'text', isInput: true, isOutput: true },
        ],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'collect', type: 'screen', label: 'Your details',
                config: { fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }] },
            },
            {
                id: 'review', type: 'screen', label: 'Review',
                config: { fields: [{ name: 'tags', label: 'Tags', type: 'text' }] },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'collect', type: 'default' },
            { id: 'e2', source: 'collect', target: 'review', type: 'default' },
            { id: 'e3', source: 'review', target: 'end', type: 'default' },
        ],
    } as any;
}

describe('callerParamKeys survives a durable pause (#19846)', () => {
    /**
     * The caller re-sent the row's own `tags`, so the inference cannot tell it
     * from the record seed and pauses `review` (pinned as the WIDENING case in
     * `screen-headless-provenance-durable-resume.test.ts`). The door said the
     * caller named `tags`, so `review` is answered — which it can only be if the
     * list came back out of the store with the rest of the context.
     */
    it('a later screen is judged by the signal read back from the store', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silentLogger(), store);
        registerScreenNodes(engine, { logger: silentLogger() } as any);
        engine.registerFlow('lead_review', twoScreenFlow());

        const lead = { id: 'lead_1', tags: ['a', 'b'], company: 'Acme Inc' };
        const paused = await engine.execute('lead_review', {
            record: lead,
            object: 'crm_lead',
            params: { ...lead, recordId: 'lead_1', crmLeadId: 'lead_1', tags: ['a', 'b'] },
            callerParamKeys: ['tags'],
        });
        // Precondition: the first screen parked, so the context went through the store.
        expect(paused.status).toBe('paused');
        expect(paused.screen?.nodeId).toBe('collect');

        const resumed = await engine.resume(paused.runId!, { variables: { full_name: 'Ada' } });
        expect(resumed.status).not.toBe('paused');
        expect(resumed.success).toBe(true);
        expect(resumed.output).toMatchObject({ full_name: 'Ada', tags: ['a', 'b'] });
    });
});

// ── Child runs ───────────────────────────────────────────────────────────

describe('a subflow / map child does not inherit the parent\'s callerParamKeys (#19846)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('child_notes', screenFlow('child_notes', [
            { name: 'notes', label: 'Notes', type: 'text' },
        ]));
    });

    function subflowParent(input: Record<string, unknown>) {
        return {
            name: 'parent_call', label: 'Parent', type: 'autolaunched', status: 'active', version: 1,
            variables: [],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child_notes', input } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call', type: 'default' },
                { id: 'e2', source: 'call', target: 'end', type: 'default' },
            ],
        } as any;
    }

    /**
     * The child's `notes` equals the inherited record's column, so the child's
     * own inference pauses. The parent's caller did name `notes` — for the
     * PARENT's bag. Inherited, that list would answer the child's screen from a
     * value the child's mapping produced.
     */
    it('subflow: the parent caller\'s list does not answer the child\'s screen', async () => {
        engine.registerFlow('parent_call', subflowParent({ notes: 'row' }));
        const lead = { id: 'lead_1', notes: 'row' };
        const res = await engine.execute('parent_call', {
            record: lead,
            object: 'crm_lead',
            params: { ...lead, recordId: 'lead_1', crmLeadId: 'lead_1', notes: 'row' },
            callerParamKeys: ['notes'],
        });
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    /**
     * The other direction, and the one an interactive parent reaches: the
     * parent's caller supplied nothing (`[]`), and the child's mapped input is
     * no column of anything. The child keeps today's reading — the mapping
     * answers it — rather than inheriting "nothing was supplied".
     */
    it('subflow: a mapped input still answers the child\'s screen as it did before the signal', async () => {
        engine.registerFlow('parent_call', subflowParent({ notes: 'from the parent' }));
        const res = await engine.execute('parent_call', {
            object: 'crm_lead',
            params: { recordId: 'lead_1', crmLeadId: 'lead_1' },
            callerParamKeys: [],
        });
        expect(res.status).not.toBe('paused');
        expect(res.success).toBe(true);
    });

    it('map: the parent caller\'s list does not answer a per-item child\'s screen', async () => {
        engine.registerFlow('parent_map', {
            name: 'parent_map', label: 'Parent', type: 'autolaunched', status: 'active', version: 1,
            variables: [{ name: 'items', type: 'list', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'each', type: 'map', label: 'For each',
                    config: { flowName: 'child_notes', collection: '{items}', iteratorVariable: 'item', input: { notes: 'row' } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each', type: 'default' },
                { id: 'e2', source: 'each', target: 'end', type: 'default' },
            ],
        } as any);
        // The item is a record, so the child's `record` is the item — whose
        // `notes` column equals the mapped input.
        const res = await engine.execute('parent_map', {
            params: { items: [{ id: 'row_1', notes: 'row' }], notes: 'row' },
            callerParamKeys: ['items', 'notes'],
        });
        expect(res.status).toBe('paused');
        // A map pause does not surface the child's screen; the child run does.
        const child = engine.listSuspendedRuns().find((r) => r.flowName === 'child_notes');
        expect(child?.nodeId).toBe('screen_1');
    });
});
