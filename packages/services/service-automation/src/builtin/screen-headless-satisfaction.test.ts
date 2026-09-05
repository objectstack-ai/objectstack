// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A screen the CALLER already answered no longer parks the run (#15705).
 *
 * The reported dead end: an `ai.exposed` action whose target is a screen flow
 * can be STARTED over MCP and never finished. `run_action` seeds the flow's
 * `isInput` variables from the caller's `params` — `seedFlowActionParams` does
 * that correctly — and the screen node suspended anyway, because the only
 * inputs to `shouldPause` were "does the node declare fields" and the author's
 * `waitForInput` flag. The MCP tool set has no resume verb, so the run parked
 * on the screen with nothing able to continue it: `ai.exposed` meant "the agent
 * can invoke this", not "the agent can complete this".
 *
 * ## What this file pins, and why the controls outnumber the fix
 *
 * The fix is one line of predicate; the risk is entirely in the OTHER runs that
 * reach it. A screen node is also entered by interactive console runs, by
 * record-change and scheduled triggers, and by region bodies — and the failure
 * mode of getting this wrong is silent: a screen that stops rendering for a
 * human. So every narrowing in `judgeHeadlessScreen` has a control here, and
 * the interactive-still-pauses control is the load-bearing one.
 *
 * The sharpest of them is `seeded params`: the bag the engine receives from a
 * flow ACTION is not the caller's bag. `seedFlowActionParams` returns
 * `{ ...record, recordId, <objectName>Id, ...params }`, so every column of the
 * subject row arrives in `context.params` whether the caller named it or not.
 * Reading "the key is in params" as "the caller supplied it" would let an
 * interactive console run — which supplies nothing — skip a screen whose field
 * shares a name with a column of the record it was launched from. Those runs
 * are reproduced here through the real seeding shape, not a hand-made bag.
 *
 * ⛔ This does NOT claim screen flows are completable over MCP in general: a
 * call that omits the inputs still parks (pinned below), and nothing on that
 * surface can resume it. That half is a resume verb and is not this change.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/**
 * The card's specimen, reduced to the platform facts: a `screen` flow whose
 * first node after `start` collects the same names the flow declares as
 * `isInput` variables. `subject` and `dueDate` are required, `notes` is not.
 * All three are `isOutput` too, so a completed run reports what actually bound
 * — "it continued" and "it continued with the caller's values" are different
 * claims and the second is the one worth making.
 */
function followupFlow(overrides: Record<string, unknown> = {}) {
    return {
        name: 'schedule_followup',
        label: 'Schedule Follow-up',
        type: 'screen',
        status: 'active',
        version: 1,
        variables: [
            { name: 'subject', type: 'text', isInput: true, isOutput: true },
            { name: 'dueDate', type: 'text', isInput: true, isOutput: true },
            { name: 'notes', type: 'text', isInput: true, isOutput: true },
        ],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'screen_1', type: 'screen', label: 'Schedule Follow-up',
                config: {
                    fields: [
                        { name: 'subject', label: 'Subject', type: 'text', required: true },
                        { name: 'dueDate', label: 'Due date', type: 'date', required: true },
                        { name: 'notes', label: 'Notes', type: 'text' },
                    ],
                    ...overrides,
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
            { id: 'e2', source: 'screen_1', target: 'end', type: 'default' },
        ],
    };
}

/**
 * The params bag a flow ACTION actually reaches the engine with — the subject
 * row first, the caller's explicit params last, exactly as
 * `seedFlowActionParams` (`@objectstack/runtime`) composes it. Reproduced here
 * rather than imported so this package's pins do not depend on the other
 * package's build; the shape is asserted against the real producer's
 * documented contract in its own suite.
 */
function actionContext(
    record: Record<string, unknown>,
    params: Record<string, unknown>,
): AutomationContext {
    return {
        record,
        object: 'crm_lead',
        params: { ...record, recordId: record.id, crmLeadId: record.id, ...params },
    } as AutomationContext;
}

/**
 * The OTHER door, and the one a record-only provenance leg cannot see:
 * `POST /api/v1/automation/:name/trigger`. `buildAutomationContext`
 * (`@objectstack/runtime`) turns the console's `{recordId, objectName, params}`
 * into `params.recordId` PLUS the camelCase `<objectName>Id` alias — and sets
 * **no `context.record` at all**. So neither of those two keys is a column,
 * nothing can disprove them from the record, and a screen field named like
 * either of them would read as "the caller supplied this" on an interactive
 * console launch that supplied nothing.
 */
function triggerDoorContext(
    recordId: string,
    params: Record<string, unknown> = {},
): AutomationContext {
    return {
        object: 'crm_lead',
        event: 'manual',
        params: { ...params, recordId, crmLeadId: recordId },
    } as AutomationContext;
}

const LEAD = { id: 'lead_1', name: 'Acme', company: 'Acme Inc' };

describe('screen headless satisfaction (#15705)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
    });

    function register(overrides: Record<string, unknown> = {}, flow = followupFlow(overrides)) {
        engine.registerFlow('schedule_followup', flow as any);
    }

    // ── The fix ───────────────────────────────────────────────────────────

    it('continues past the screen when the caller supplied every required field', async () => {
        register();
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back', dueDate: '2026-09-09', notes: 'left voicemail',
        }));
        expect(res.status).not.toBe('paused');
        expect(res.screen).toBeUndefined();
        expect(res.success).toBe(true);
        // The values the caller sent are what the run carried — not merely that
        // it did not stop.
        expect(res.output).toMatchObject({
            subject: 'Call Acme back', dueDate: '2026-09-09', notes: 'left voicemail',
        });
    });

    it('continues when the caller supplied the REQUIRED fields and left an optional one out', async () => {
        register();
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back', dueDate: '2026-09-09',
        }));
        expect(res.status).not.toBe('paused');
        expect(res.success).toBe(true);
        expect(res.output).toMatchObject({ subject: 'Call Acme back', notes: undefined });
    });

    // ── The control that matters: interactive runs are untouched ──────────

    it('CONTROL — an interactive run (no params) still pauses and still renders the form', async () => {
        register();
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {}));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
        expect(res.screen?.fields.map((f) => f.name)).toEqual(['subject', 'dueDate', 'notes']);
        expect(res.screen?.fields.find((f) => f.name === 'subject')?.required).toBe(true);
    });

    it('CONTROL — a run with NO context at all still pauses (trigger / schedule shape)', async () => {
        register();
        const res = await engine.execute('schedule_followup', {} as AutomationContext);
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    /**
     * The provenance leg, stated as the regression it prevents. Here the SUBJECT
     * ROW carries columns named exactly like the screen's required fields, so
     * the dispatcher's `{ ...record }` seed puts both names in `context.params`
     * for a run that supplied nothing. Treating "in params" as "caller supplied"
     * would skip this screen for a human who pressed a button.
     */
    it('CONTROL — record columns that collide with screen field names do NOT satisfy the screen', async () => {
        register();
        const collidingLead = { ...LEAD, subject: 'row value', dueDate: '2026-01-01' };
        const res = await engine.execute('schedule_followup', actionContext(collidingLead, {}));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('a caller that OVERRIDES a colliding column is still caller-supplied and continues', async () => {
        register();
        const collidingLead = { ...LEAD, subject: 'row value', dueDate: '2026-01-01' };
        const res = await engine.execute('schedule_followup', actionContext(collidingLead, {
            subject: 'Call Acme back', dueDate: '2026-09-09',
        }));
        expect(res.status).not.toBe('paused');
        expect(res.output).toMatchObject({ subject: 'Call Acme back', dueDate: '2026-09-09' });
    });

    it('CONTROL — a partially supplied screen still pauses (one required field missing)', async () => {
        register();
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back',
        }));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('CONTROL — an empty string does not answer a required field', async () => {
        register();
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back', dueDate: '   ',
        }));
        expect(res.status).toBe('paused');
    });

    // ── The row-id seeds are not the caller speaking ──────────────────────
    //
    // Both dispatch doors put the launched row's id into `params` under names
    // that are NOT record columns, so the record leg alone cannot disprove
    // them. A screen field named like one of them must therefore not count as
    // answered — otherwise an interactive console launch, which supplies
    // nothing but the record it was launched from, skips the screen.

    it('CONTROL — trigger door: a required `recordId` field does NOT satisfy an interactive launch', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [
            { name: 'recordId', label: 'Record', type: 'text', required: true },
            { name: 'notes', label: 'Notes', type: 'text' },
        ];
        flow.variables = [
            { name: 'recordId', type: 'text', isInput: true, isOutput: true },
            { name: 'notes', type: 'text', isInput: true, isOutput: true },
        ];
        register({}, flow);
        const res = await engine.execute('schedule_followup', triggerDoorContext('lead_1'));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('CONTROL — trigger door: the camelCase `<object>Id` alias does not satisfy it either', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [{ name: 'crmLeadId', label: 'Lead', type: 'text', required: true }];
        flow.variables = [{ name: 'crmLeadId', type: 'text', isInput: true, isOutput: true }];
        register({}, flow);
        const res = await engine.execute('schedule_followup', triggerDoorContext('lead_1'));
        expect(res.status).toBe('paused');
    });

    it('CONTROL — actions door: the same two seeded id keys do not satisfy it', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [
            { name: 'recordId', label: 'Record', type: 'text', required: true },
            { name: 'crmLeadId', label: 'Lead', type: 'text', required: true },
        ];
        flow.variables = [
            { name: 'recordId', type: 'text', isInput: true, isOutput: true },
            { name: 'crmLeadId', type: 'text', isInput: true, isOutput: true },
        ];
        register({}, flow);
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {}));
        expect(res.status).toBe('paused');
    });

    /**
     * `recordIdParam` is action-level metadata the executor cannot see, so its
     * NAME cannot be refused — its VALUE is. The dispatcher seeds it with the
     * row id, so a field bound to the row id is never the caller speaking.
     */
    it("CONTROL — a field carrying the row id under the action's own `recordIdParam` name does not satisfy it", async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [{ name: 'leadRef', label: 'Lead ref', type: 'text', required: true }];
        flow.variables = [{ name: 'leadRef', type: 'text', isInput: true, isOutput: true }];
        register({}, flow);
        // What `seedFlowActionParams` produces for `recordIdParam: 'leadRef'`.
        const res = await engine.execute('schedule_followup', actionContext(LEAD, { leadRef: LEAD.id }));
        expect(res.status).toBe('paused');
    });

    it('trigger door: a genuine caller param still satisfies the screen', async () => {
        register();
        const res = await engine.execute('schedule_followup', triggerDoorContext('lead_1', {
            subject: 'Call Acme back', dueDate: '2026-09-09',
        }));
        expect(res.status).not.toBe('paused');
        expect(res.output).toMatchObject({ subject: 'Call Acme back', dueDate: '2026-09-09' });
    });

    /**
     * The record-change trigger's shape, pinned for the MECHANISM as well as
     * the outcome: it sets `params` to the SAME object it sets as `record`
     * (`record-change-trigger.ts`), so `params` is emphatically NOT empty — it
     * pauses because every key is identity-equal to the record's own value, not
     * because there was nothing to read.
     */
    it('CONTROL — record-change trigger shape: params IS the record, and it still pauses', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [{ name: 'company', label: 'Company', type: 'text', required: true }];
        flow.variables = [{ name: 'company', type: 'text', isInput: true, isOutput: true }];
        register({}, flow);
        const isolated = { ...LEAD };
        const res = await engine.execute('schedule_followup', {
            record: isolated, params: isolated, object: 'crm_lead', event: 'on_update',
        } as AutomationContext);
        expect(res.status).toBe('paused');
        expect(Object.keys((isolated as Record<string, unknown>))).toContain('company');
    });

    // ── Vacuity guards: a screen with nothing to satisfy must not be skipped ──

    it('CONTROL — an explicit `waitForInput: true` still pauses even when fully supplied', async () => {
        register({ waitForInput: true });
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back', dueDate: '2026-09-09',
        }));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('CONTROL — a message-only screen (no fields) still pauses; a bag cannot vacuously answer it', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config = { title: 'Confirm', waitForInput: true };
        register({}, flow);
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {
            subject: 'Call Acme back', dueDate: '2026-09-09',
        }));
        expect(res.status).toBe('paused');
        expect(res.screen?.nodeId).toBe('screen_1');
    });

    it('CONTROL — an all-optional screen still pauses when the caller named none of its fields', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [{ name: 'notes', label: 'Notes', type: 'text' }];
        register({}, flow);
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {}));
        expect(res.status).toBe('paused');
    });

    it('an all-optional screen the caller DID name is answered and continues', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [{ name: 'notes', label: 'Notes', type: 'text' }];
        register({}, flow);
        const res = await engine.execute('schedule_followup', actionContext(LEAD, { notes: 'left voicemail' }));
        expect(res.status).not.toBe('paused');
        expect(res.output).toMatchObject({ notes: 'left voicemail' });
    });

    /**
     * `visibleWhen` is enforced HERE and deliberately not on the resume door.
     * The server has no client and no collected values, so it cannot evaluate
     * the predicate — but refusing costs only a pause, which is what this
     * screen does today anyway. The resume door makes the opposite call for the
     * opposite reason: there, demanding a hidden field dead-ends a run at
     * Submit (#3528).
     */
    it('CONTROL — a conditional required field the caller did not name keeps the screen interactive', async () => {
        const flow: any = followupFlow();
        flow.nodes[1].config.fields = [
            { name: 'subject', label: 'Subject', type: 'text', required: true },
            { name: 'notes', label: 'Reason', type: 'text', required: true, visibleWhen: "subject == 'escalate'" },
        ];
        register({}, flow);
        const res = await engine.execute('schedule_followup', actionContext(LEAD, { subject: 'Call Acme back' }));
        expect(res.status).toBe('paused');
    });

    it('CONTROL — `waitForInput: false` is still a pass-through, unchanged', async () => {
        register({ waitForInput: false });
        const res = await engine.execute('schedule_followup', actionContext(LEAD, {}));
        expect(res.status).not.toBe('paused');
        expect(res.success).toBe(true);
    });
});
