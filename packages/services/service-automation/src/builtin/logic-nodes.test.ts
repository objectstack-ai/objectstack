// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

function createCtx() {
    return { logger: createTestLogger(), getService: () => undefined } as any;
}

/**
 * A one-`assignment`-node flow. `outputs` are declared as flow output variables
 * so the assigned values surface on {@link AutomationResult.output}.
 */
function assignmentFlow(config: Record<string, unknown>, outputs: string[] = ['approval_path']) {
    return {
        name: 'assign_flow',
        label: 'Assign Flow',
        type: 'autolaunched' as const,
        variables: outputs.map((name) => ({ name, type: 'text', isOutput: true })),
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'assign', type: 'assignment' as const, label: 'Set variables', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'assign' },
            { id: 'e2', source: 'assign', target: 'end' },
        ],
    };
}

describe('assignment node — config-shape parity (Studio + examples)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerLogicNodes(engine, createCtx());
    });

    // The shape the Studio visual builder's Assignment editor emits:
    //   config: { assignments: { <var>: <value> } }
    it('sets the variable from the Studio `assignments` map shape', async () => {
        engine.registerFlow('assign_flow', assignmentFlow({ assignments: { approval_path: 'Manager OK' } }));
        const result = await engine.execute('assign_flow', {} as any);
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ approval_path: 'Manager OK' });
    });

    // The shape the bundled example flows emit (app-crm, showcase):
    //   config: { assignments: [{ variable, value }] }
    it('sets variables from the `assignments` array shape', async () => {
        engine.registerFlow('assign_flow', assignmentFlow({
            assignments: [{ variable: 'approval_path', value: 'Director sign-off' }],
        }));
        const result = await engine.execute('assign_flow', {} as any);
        expect(result.output).toEqual({ approval_path: 'Director sign-off' });
    });

    // The legacy flat top-level shape (config keys ARE the variables) still works.
    it('still supports the flat key->value shape', async () => {
        engine.registerFlow('assign_flow', assignmentFlow({ approval_path: 'Flat works' }));
        const result = await engine.execute('assign_flow', {} as any);
        expect(result.output).toEqual({ approval_path: 'Flat works' });
    });

    // [#19939] A computed value is a CEL value envelope — the `{var}` template
    // dialect is retired from assignment values (the C half of #11182 ruling D).
    it('computes a value from the live flow variables with a CEL value envelope', async () => {
        const flow = assignmentFlow({ assignments: { greeting: { dialect: 'cel', source: "'Hello ' + name" } } }, ['greeting']);
        flow.variables.push({ name: 'name', type: 'text', isInput: true } as any);
        engine.registerFlow('assign_flow', flow);
        const result = await engine.execute('assign_flow', { params: { name: 'Ada' } } as any);
        expect(result.output).toEqual({ greeting: 'Hello Ada' });
    });

    it.each([
        ['the Studio map', { assignments: { greeting: 'Hello {name}' } }, 'config.assignments.greeting'],
        ['the legacy array', { assignments: [{ variable: 'greeting', value: 'Hello {name}' }] }, 'config.assignments[0].value'],
        ['the legacy flat shape', { greeting: 'Hello {name}' }, 'config.greeting'],
    ])('[#19939] refuses the retired `{var}` dialect at registration in %s, located, with the CEL spelling', (_shape, config, at) => {
        expect(() => engine.registerFlow('assign_flow', assignmentFlow(config, ['greeting'])))
            .toThrow(VALUE_SLOT_TEMPLATE_REFUSAL);
        let message = '';
        try { engine.registerFlow('assign_flow', assignmentFlow(config, ['greeting'])); } catch (err) { message = (err as Error).message; }
        expect(message).toContain(`node 'assign' (assignment) assignment value at ${at}`);
        expect(message).toContain(`source: "'Hello ' + name"`);
    });

    it('[#19939] the run-time twin: the executor refuses the same value before assigning anything', async () => {
        // Reached only by a flow that bypassed registration — captured straight
        // off the registry the executors are handed.
        const executors = new Map<string, any>();
        registerLogicNodes({ registerNodeExecutor: (e: any) => executors.set(e.type, e) } as any, createCtx());
        const variables = new Map<string, unknown>([['name', 'Ada']]);
        const result = await executors.get('assignment').execute(
            { id: 'assign', type: 'assignment', config: { assignments: { kept: 'x', greeting: 'Hello {name}' } } },
            variables,
            {} as any,
        );
        expect(result.success).toBe(false);
        expect(result.errorClass).toBe('guard');
        expect(result.error).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
        expect(result.error).toContain('config.assignments.greeting');
        expect(variables.has('kept'), 'nothing is assigned once the node is refused').toBe(false);
    });

    it('[#19939] the two spellings CEL cannot write yet keep resolving — a date macro and `$User`', async () => {
        engine.registerFlow('assign_flow', assignmentFlow({ assignments: { day: '{TODAY()}', who: '{$User.Id}' } }, ['day', 'who']));
        const result = await engine.execute('assign_flow', { userId: 'usr_1' } as any);
        expect(result.success).toBe(true);
        const output = result.output as Record<string, unknown>;
        expect(output.who).toBe('usr_1');
        expect(String(output.day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
