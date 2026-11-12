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

/**
 * Ruling 6810500711 (letter D): a flow that runs after a record change holds
 * the save until it returns, so an outbound call it retries inline holds the
 * save for the whole backoff ladder. Registration refuses that node, naming it
 * and the background path; the durable node, the unretried node and every
 * flow no save waits on register as before.
 */
describe('registration: an inline outbound call retried in an after-save flow is refused', () => {
    const silent = () => loggerCapturing([]);
    const http = (config: Record<string, unknown> = {}) => ({
        id: 'push', type: 'http', label: 'Push',
        config: { url: 'https://api.example.com/v1/tasks', method: 'POST', body: { id: 1 }, ...config },
    });
    const connector = () => ({
        id: 'post_slack', type: 'connector_action', label: 'Post',
        connectorConfig: { connectorId: 'slack', actionId: 'post_message', input: {} },
    });
    const flag = { id: 'flag', type: 'assignment', label: 'Flag', config: { failed: true } };
    const guarded = (inner: unknown, maxRetries = 3, catchNodes: unknown[] = [flag]) => ({
        id: 'guarded_push', type: 'try_catch', label: 'Push with retry',
        config: {
            retry: { maxRetries, backoffMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 },
            try: { nodes: [inner], edges: [] },
            catch: { nodes: catchNodes, edges: [] },
        },
    });
    const flowOf = (startConfig: Record<string, unknown> | undefined, step: unknown, extra: Record<string, unknown> = {}) => ({
        name: 'sync', label: 'Sync', type: 'autolaunched', status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', ...(startConfig ? { config: startConfig } : {}) },
            step,
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: (step as { id: string }).id },
            { id: 'e2', source: (step as { id: string }).id, target: 'end' },
        ],
        ...extra,
    });
    const afterUpdate = { objectName: 'task', triggerType: 'record-after-update' };
    const refusalOf = (flow: unknown): Error => {
        try {
            new AutomationEngine(silent()).registerFlow('sync', flow as never);
        } catch (e) {
            return e as Error;
        }
        throw new Error('control: registerFlow was expected to refuse this flow');
    };
    const registers = async (flow: unknown) => {
        const engine = new AutomationEngine(silent());
        engine.registerFlow('sync', flow as never);
        return (await engine.getFlow('sync')) !== null;
    };

    it.each(['record-after-create', 'record-after-update', 'record-after-delete', 'record-after-write'])(
        '%s: an inline http node inside a retrying try_catch is refused, naming the node, the retry and the fix',
        async (triggerType) => {
            const engine = new AutomationEngine(silent());
            const flow = flowOf({ objectName: 'task', triggerType }, guarded(http()));
            expect(() => engine.registerFlow('sync', flow as never)).toThrow(/^Flow 'sync' rejected: 1 inline outbound call\(s\) retried on the save path/);
            const message = refusalOf(flow).message;
            expect(message).toContain("node 'push' (`http`)");
            expect(message).toContain("`try_catch` 'guarded_push' (`retry.maxRetries: 3`)");
            expect(message).toContain('Set `durable: true` on the node');
            expect(await engine.getFlow('sync')).toBeNull();
        },
    );

    it('the flow-level retry (`errorHandling.strategy: retry`) reaches an inline http node outside any try_catch', () => {
        const flow = flowOf(afterUpdate, http(), { errorHandling: { strategy: 'retry', maxRetries: 2 } });
        expect(refusalOf(flow).message).toContain("retried by the flow's `errorHandling` (`strategy: 'retry'`, `maxRetries: 2`)");
    });

    it('a retried connector_action is refused with its own fix: it has no background path', () => {
        const message = refusalOf(flowOf(afterUpdate, guarded(connector()))).message;
        expect(message).toContain("node 'post_slack' (`connector_action`)");
        expect(message).toContain('remove the retry around it, or send the call through an `http` node with `durable: true`');
    });

    it('a node nested deeper in the retried try region (a loop body) is refused too', () => {
        const loop = {
            id: 'each', type: 'loop', label: 'Each',
            config: { collection: { dialect: 'cel', source: '[1, 2]' }, body: { nodes: [http()], edges: [] } },
        };
        expect(refusalOf(flowOf(afterUpdate, guarded(loop))).message).toContain("node 'push' (`http`)");
    });

    it('the same node with `durable: true` registers: the save no longer waits for it', async () => {
        expect(await registers(flowOf(afterUpdate, guarded(http({ durable: true }))))).toBe(true);
        expect(await registers(flowOf(afterUpdate, http({ durable: true }), { errorHandling: { strategy: 'retry', maxRetries: 2 } }))).toBe(true);
    });

    it('control: an inline call that is not retried registers (`maxRetries: 0`, no retry, or in the catch region)', async () => {
        expect(await registers(flowOf(afterUpdate, http()))).toBe(true);
        expect(await registers(flowOf(afterUpdate, guarded(http(), 0)))).toBe(true);
        expect(await registers(flowOf(afterUpdate, guarded(flag, 3, [http()])))).toBe(true);
    });

    it('control: a before-trigger, a scheduled and a manual flow with the inline retried node register', async () => {
        expect(await registers(flowOf({ objectName: 'task', triggerType: 'record-before-update' }, guarded(http())))).toBe(true);
        expect(await registers(flowOf({ schedule: { type: 'cron', expression: '0 8 * * *' } }, guarded(http()), { type: 'schedule' }))).toBe(true);
        expect(await registers(flowOf(undefined, guarded(http())))).toBe(true);
    });
});
