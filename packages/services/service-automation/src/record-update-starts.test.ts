// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#35928] `AutomationEngine.listRecordUpdateStarts` — which flows a proposed
// update of one record would start (ruling record 7073655354): enabled,
// armed record-change flows of the object whose token binds an update and
// whose start condition holds, through the engine's one start-condition gate;
// each served as `{ name, label, startsApproval }`.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger } from './engine.js';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

const recordChangeTrigger: FlowTrigger = { type: 'record_change', start() {}, stop() {} };

function updateFlow(
    name: string,
    start: Record<string, unknown>,
    options: { label?: string; approval?: boolean } = {},
) {
    const middle = options.approval
        ? [{ id: 'review', type: 'approval' as const, label: 'Review', config: { approvers: [{ type: 'user', value: 'u1' }] } }]
        : [];
    const chain = ['start', ...middle.map((n) => n.id), 'end'];
    return {
        name,
        label: options.label ?? name,
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start', config: { objectName: 'project', triggerType: 'record-after-update', ...start } },
            ...middle,
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: chain.slice(1).map((target, i) => ({ id: `e${i}`, source: chain[i], target })),
    };
}

const STORED = { id: 'p1', status: 'active', health: 'green' };

describe('AutomationEngine.listRecordUpdateStarts (#35928)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        // The approval node's executor stands in for plugin-approvals' own.
        engine.registerNodeExecutor({ type: 'approval', async execute() { return { success: true }; } });
        engine.registerTrigger(recordChangeTrigger);
    });

    const ask = (changes: Record<string, unknown>) =>
        engine.listRecordUpdateStarts({ object: 'project', previous: { ...STORED }, record: { ...STORED, ...changes } });

    it('names a flow whose start condition holds for the proposed change, by name and label', async () => {
        engine.registerFlow('closure', updateFlow('closure', { condition: 'status == "completed" && previous.status != "completed"' }, { label: 'Project Closure' }));
        expect(ask({ status: 'completed' })).toEqual([{ name: 'closure', label: 'Project Closure', startsApproval: false }]);
    });

    it('does not name a flow whose start condition does not hold', async () => {
        engine.registerFlow('closure', updateFlow('closure', { condition: 'status == "completed" && previous.status != "completed"' }));
        expect(ask({ status: 'on_hold' })).toEqual([]);
    });

    it('marks a flow holding an approval node as starting an approval — and only that one (CONTROL)', async () => {
        engine.registerFlow('signoff', updateFlow('signoff', { condition: 'status == "completed"' }, { approval: true }));
        engine.registerFlow('notify', updateFlow('notify', { condition: 'status == "completed"' }));
        const starts = ask({ status: 'completed' });
        expect(starts.find((s) => s.name === 'signoff')?.startsApproval).toBe(true);
        expect(starts.find((s) => s.name === 'notify')?.startsApproval).toBe(false);
    });

    it('names a flow with no condition on every update', async () => {
        engine.registerFlow('every_update', updateFlow('every_update', {}, { label: 'Every Update' }));
        expect(ask({ health: 'red' })).toEqual([{ name: 'every_update', label: 'Every Update', startsApproval: false }]);
    });

    it('binds update tokens only: a create, a delete, another object or a disabled flow is never named', async () => {
        engine.registerFlow('on_create', updateFlow('on_create', { triggerType: 'record-after-create' }));
        engine.registerFlow('on_delete', updateFlow('on_delete', { triggerType: 'record-before-delete' }));
        engine.registerFlow('other_object', updateFlow('other_object', { objectName: 'task' }));
        engine.registerFlow('switched_off', { ...updateFlow('switched_off', {}), status: 'obsolete' } as any);
        engine.registerFlow('on_write', updateFlow('on_write', { triggerType: 'record-before-write' }));
        expect(ask({ status: 'completed' }).map((s) => s.name)).toEqual(['on_write']);
    });

    it('does not name a flow whose condition cannot be evaluated against the record', async () => {
        engine.registerFlow('reads_missing', updateFlow('reads_missing', { condition: 'record.no_such_field == "x"' }));
        expect(ask({ status: 'completed' })).toEqual([]);
    });

    it('answers nothing for a flow the engine holds but has not armed (no record-change trigger)', async () => {
        const bare = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        bare.registerFlow('closure', updateFlow('closure', {}));
        expect(bare.listRecordUpdateStarts({ object: 'project', previous: STORED, record: STORED })).toEqual([]);
    });

    it('evaluates `current_user` as the writer the caller names', async () => {
        engine.registerFlow('mine', updateFlow('mine', { condition: 'current_user.id == "u_writer"' }));
        const asWriter = engine.listRecordUpdateStarts({ object: 'project', previous: STORED, record: STORED, userId: 'u_writer' });
        const asOther = engine.listRecordUpdateStarts({ object: 'project', previous: STORED, record: STORED, userId: 'u_other' });
        expect(asWriter.map((s) => s.name)).toEqual(['mine']);
        expect(asOther).toEqual([]);
    });
});

// [#36322] The approval mark follows the flows a run calls: a flow that
// reaches its approval through a `subflow` node starts an approval as surely
// as one holding the node, and the one approval test is asked of each flow.
describe('AutomationEngine.listRecordUpdateStarts — approval reached through a subflow (#36322)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        // Stand-ins for plugin-approvals' executor and the built-in subflow node's.
        engine.registerNodeExecutor({ type: 'approval', async execute() { return { success: true }; } });
        engine.registerNodeExecutor({ type: 'subflow', async execute() { return { success: true }; } });
        engine.registerTrigger(recordChangeTrigger);
    });

    /** A flow no trigger starts: `start`, then an approval and/or a subflow call, then `end`. */
    function calledFlow(name: string, options: { approval?: boolean; calls?: string } = {}) {
        const middle = [
            ...(options.approval
                ? [{ id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'user', value: 'u1' }] } }]
                : []),
            ...(options.calls ? [{ id: 'call', type: 'subflow', label: 'Call', config: { flowName: options.calls } }] : []),
        ];
        const chain = ['start', ...middle.map((n) => n.id), 'end'];
        return {
            name,
            label: name,
            type: 'autolaunched' as const,
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                ...middle,
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: chain.slice(1).map((target, i) => ({ id: `e${i}`, source: chain[i], target })),
        };
    }

    /** The record-change flow under test: on completion, call `child`. */
    function closureCalling(child: string) {
        const flow = updateFlow('closure', { condition: 'status == "completed"' }, { label: 'Project Closure' });
        return {
            ...flow,
            nodes: [flow.nodes[0], { id: 'call', type: 'subflow', label: 'Call', config: { flowName: child } }, flow.nodes[1]],
            edges: [
                { id: 'e0', source: 'start', target: 'call' },
                { id: 'e1', source: 'call', target: 'end' },
            ],
        };
    }

    const startsApproval = () =>
        engine
            .listRecordUpdateStarts({ object: 'project', previous: { ...STORED }, record: { ...STORED, status: 'completed' } })
            .find((s) => s.name === 'closure')?.startsApproval;

    it('marks a flow whose subflow holds the approval node', () => {
        engine.registerFlow('signoff', calledFlow('signoff', { approval: true }));
        engine.registerFlow('closure', closureCalling('signoff'));
        expect(startsApproval()).toBe(true);
    });

    it('marks a flow whose approval sits two calls down', () => {
        engine.registerFlow('signoff', calledFlow('signoff', { approval: true }));
        engine.registerFlow('relay', calledFlow('relay', { calls: 'signoff' }));
        engine.registerFlow('closure', closureCalling('relay'));
        expect(startsApproval()).toBe(true);
    });

    it('does not mark a flow whose subflow holds no approval (CONTROL)', () => {
        engine.registerFlow('notify', calledFlow('notify'));
        engine.registerFlow('closure', closureCalling('notify'));
        expect(startsApproval()).toBe(false);
    });

    it('ends on a flow that calls itself, and on a cycle of flows, without marking either', () => {
        engine.registerFlow('closure', closureCalling('closure'));
        expect(startsApproval()).toBe(false);

        engine.unregisterFlow('closure');
        engine.registerFlow('echo', calledFlow('echo', { calls: 'closure' }));
        engine.registerFlow('closure', closureCalling('echo'));
        expect(startsApproval()).toBe(false);
    });

    it('does not follow a call to a disabled flow: its run is refused, so it starts no approval', () => {
        engine.registerFlow('signoff', { ...calledFlow('signoff', { approval: true }), status: 'obsolete' } as any);
        engine.registerFlow('closure', closureCalling('signoff'));
        expect(startsApproval()).toBe(false);
    });

    it('does not follow a call to a flow the engine does not hold', () => {
        engine.registerFlow('closure', closureCalling('never_registered'));
        expect(startsApproval()).toBe(false);
    });
});
