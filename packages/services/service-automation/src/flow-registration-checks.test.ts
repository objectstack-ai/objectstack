// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';

/**
 * The registration pass's advisory schema check (#1928) types a flow's
 * conditions against ONE object. For a time-relative flow that object is the
 * one the run binds — `config.timeRelative.object` when it is a string, the
 * start node's `config.objectName` only otherwise (`deriveTriggerBinding`) —
 * because the sweep launches each run with a row of THAT object as its record
 * (#30396). A start whose `objectName` names another object is refused at
 * publish (`flow-time-relative-object-mismatch`), but a flow stored before
 * that rule still registers, so the advisory must point at the scanned object.
 */
function loggerCapturing(warns: string[]) {
    const l: any = {
        info: () => {}, error: () => {}, debug: () => {},
        warn: (m: string) => warns.push(m),
        child: () => l,
    };
    return l;
}

const SCHEMAS: Record<string, { fields: string[]; fieldTypes: Record<string, string> }> = {
    // The start node's objectName in the two-object flow — NOT what the run binds.
    crm_account: { fields: ['industry'], fieldTypes: { industry: 'text' } },
    // The swept object: every run's record is one of its rows.
    crm_contract: { fields: ['end_date', 'renewal_status'], fieldTypes: { end_date: 'date', renewal_status: 'select' } },
};

function timeRelativeFlow(condition: string, startObject: string | undefined) {
    return {
        name: 'renewal_alert', label: 'Renewal Alert', type: 'schedule',
        nodes: [
            {
                id: 'start', type: 'start', label: 'Start',
                config: {
                    ...(startObject ? { objectName: startObject } : {}),
                    timeRelative: { object: 'crm_contract', dateField: 'end_date', offsetDays: [30] },
                    schedule: { type: 'cron', expression: '0 8 * * *' },
                },
            },
            { id: 'check', type: 'decision', label: 'Check', config: { condition } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'check' },
            { id: 'e2', source: 'check', target: 'end' },
        ],
    };
}

function register(flow: unknown): string[] {
    const warns: string[] = [];
    const engine = new AutomationEngine(loggerCapturing(warns));
    engine.setObjectSchemaResolver((name) => SCHEMAS[name]);
    expect(() => engine.registerFlow('renewal_alert', flow as never)).not.toThrow();
    return warns.filter((m) => /unknown field|did you mean|type mismatch/i.test(m));
}

describe('registration advisory: a time-relative flow is typed against the swept object (#30396)', () => {
    it('a stored two-object flow: a field of the swept object passes', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', 'crm_account'))).toEqual([]);
    });

    it('a stored two-object flow: a field only the start node\'s objectName has warns', () => {
        const warns = register(timeRelativeFlow('record.industry == "tech"', 'crm_account'));
        expect(warns).toHaveLength(1);
        expect(warns[0]).toMatch(/unknown field `industry`/);
    });

    it('a one-object flow (objectName equals timeRelative.object) is unchanged', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', 'crm_contract'))).toEqual([]);
        expect(register(timeRelativeFlow('record.renewl_status == "pending"', 'crm_contract')).join('\n'))
            .toMatch(/unknown field `renewl_status`/);
    });

    it('a sweep-only flow (no objectName) is typed against the swept object', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', undefined))).toEqual([]);
        expect(register(timeRelativeFlow('record.industry == "tech"', undefined)).join('\n'))
            .toMatch(/unknown field `industry`/);
    });
});

/**
 * A flow with no `start` node can never run: `execute()` begins at that node,
 * so before this check the shape registered (and the `POST /automation` door
 * answered 200 for it) and failed only at the first trigger, with
 * `FLOW_NO_START_NODE`. The check refuses it at registration, located at the
 * flow's `nodes` and naming the missing `start` node, whatever the status.
 */
describe('registration: a flow with no start node is refused, naming the missing node', () => {
    const silent = () => loggerCapturing([]);
    const startless = (status: string, nodes: unknown[] = [{ id: 'notify_owner', type: 'end', label: 'End' }]) => ({
        name: 'no_start', label: 'No Start', type: 'autolaunched', status, nodes, edges: [],
    });
    const refusalOf = (flow: unknown): Error => {
        try {
            new AutomationEngine(silent()).registerFlow('no_start', flow as never);
        } catch (e) {
            return e as Error;
        }
        throw new Error('control: registerFlow was expected to refuse this flow');
    };

    it.each(['active', 'draft', 'obsolete'])('status %s: refused, the message names the missing start node and the cure', async (status) => {
        const engine = new AutomationEngine(silent());
        expect(() => engine.registerFlow('no_start', startless(status) as never))
            .toThrow(/^Flow 'no_start' rejected: the flow's top-level `nodes` hold no `start` node \(found 1 node\(s\), of type `end`\)/);
        const message = refusalOf(startless(status)).message;
        expect(message).toContain('FLOW_NO_START_NODE');
        expect(message).toContain("Add a node with `type: 'start'`");
        // Nothing was armed: the refusal is thrown before anything is held.
        expect(await engine.getFlow('no_start')).toBeNull();
    });

    it('an empty `nodes` list is refused the same way', () => {
        expect(refusalOf(startless('active', [])).message).toMatch(/hold no `start` node \(the list is empty\)/);
    });

    it('a start node only inside a loop body does not count: the flow\'s own graph has none', () => {
        const flow = startless('active', [{
            id: 'each', type: 'loop', label: 'Each',
            config: {
                collection: { dialect: 'cel', source: 'items' },
                body: { nodes: [{ id: 'inner', type: 'notify', label: 'Tell', config: { recipients: ['usr_1'], title: 'Hi', message: 'Done' } }], edges: [] },
            },
        }]);
        expect(refusalOf(flow).message).toMatch(/hold no `start` node \(found 1 node\(s\), of type `loop`\)/);
    });

    it('control: the same flow with a start node registers, in every status', async () => {
        for (const status of ['active', 'draft', 'obsolete']) {
            const engine = new AutomationEngine(silent());
            engine.registerFlow('no_start', startless(status, [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'notify_owner', type: 'end', label: 'End' },
            ]) as never);
            expect(await engine.getFlow('no_start'), status).not.toBeNull();
        }
    });
});
