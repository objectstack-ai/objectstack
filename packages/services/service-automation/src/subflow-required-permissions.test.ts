// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A flow's `requiredPermissions` says who may START it at a door — the trigger
// route, an action of `type: 'flow'`, a declared endpoint (ruling record
// 6377848497, letter A; the check is the runtime's `flowStartRefusal`). A
// parent flow's `subflow` node is NOT a door: it starts its child through the
// engine, and the parent's own start was the admission. So the engine itself
// never reads the key, and a gated child called from its parent runs for a
// caller who holds nothing. The door half is the runtime's
// `flow-start-required-permissions.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import { registerSubflowNode } from './builtin/subflow-node.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

const CAP = 'srp_verify_bank_account';

const CHILD = {
    name: 'srp_child',
    label: 'Gated child',
    type: 'autolaunched',
    runAs: 'system',
    requiredPermissions: [CAP],
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const PARENT = {
    name: 'srp_parent',
    label: 'Parent',
    type: 'screen',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'srp_child' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'call' },
        { id: 'e2', source: 'call', target: 'end' },
    ],
};

describe("a parent flow's subflow node is not a start door", () => {
    it('the engine keeps the declaration on the definition the doors read', async () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerFlow(CHILD.name, CHILD);

        expect((await engine.getFlow(CHILD.name))?.requiredPermissions).toEqual([CAP]);
    });

    it('a gated child runs from its parent for a member holding no capability', async () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerFlow(CHILD.name, CHILD);
        engine.registerFlow(PARENT.name, PARENT);
        registerSubflowNode(engine, { logger: createTestLogger(), getService: () => undefined } as any);
        const execute = vi.spyOn(engine, 'execute');

        const result = await engine.execute(PARENT.name, { userId: 'member_1', permissions: [] } as any);

        expect(result, JSON.stringify(result)).toMatchObject({ success: true });
        // The child was started by the parent's subflow node, and it ran.
        const childCall = execute.mock.calls.findIndex(([name]) => name === CHILD.name);
        expect(childCall).toBeGreaterThan(-1);
        const childResult = await execute.mock.results[childCall]!.value;
        expect(childResult.success).toBe(true);
    });
});
