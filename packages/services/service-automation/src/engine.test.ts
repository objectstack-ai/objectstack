// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import type { NodeExecutor } from './engine.js';
import type { IAutomationService } from '@objectstack/spec/contracts';

// ─── Helper: Create a minimal logger for unit tests ─────────────────

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

// ─── AutomationEngine Unit Tests ─────────────────────────────────────

describe('AutomationEngine', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    describe('Node Executor Registration', () => {
        it('should register a node executor', () => {
            const executor: NodeExecutor = {
                type: 'test_node',
                async execute() {
                    return { success: true };
                },
            };
            engine.registerNodeExecutor(executor);
            expect(engine.getRegisteredNodeTypes()).toContain('test_node');
        });

        it('should replace an existing executor for the same type', () => {
            engine.registerNodeExecutor({
                type: 'test_node',
                async execute() {
                    return { success: true, output: { version: 1 } };
                },
            });
            engine.registerNodeExecutor({
                type: 'test_node',
                async execute() {
                    return { success: true, output: { version: 2 } };
                },
            });
            expect(engine.getRegisteredNodeTypes().filter(t => t === 'test_node')).toHaveLength(1);
        });

        it('should unregister a node executor', () => {
            engine.registerNodeExecutor({
                type: 'test_node',
                async execute() {
                    return { success: true };
                },
            });
            engine.unregisterNodeExecutor('test_node');
            expect(engine.getRegisteredNodeTypes()).not.toContain('test_node');
        });
    });

    describe('Trigger Registration', () => {
        it('should register and unregister a trigger', () => {
            engine.registerTrigger({
                type: 'schedule',
                start: () => {},
                stop: () => {},
            });
            expect(engine.getRegisteredTriggerTypes()).toContain('schedule');

            engine.unregisterTrigger('schedule');
            expect(engine.getRegisteredTriggerTypes()).not.toContain('schedule');
        });
    });

    describe('Flow Registration', () => {
        it('should register and list flows', async () => {
            engine.registerFlow('test_flow', {
                name: 'test_flow',
                label: 'Test Flow',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'end' }],
            });

            const flows = await engine.listFlows();
            expect(flows).toContain('test_flow');
        });

        it('should unregister a flow', async () => {
            engine.registerFlow('temp_flow', {
                name: 'temp_flow',
                label: 'Temp',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'end' }],
            });
            engine.unregisterFlow('temp_flow');
            const flows = await engine.listFlows();
            expect(flows).not.toContain('temp_flow');
        });

        it('should reject invalid flow definitions', () => {
            expect(() => engine.registerFlow('bad', { invalid: true })).toThrow();
        });
    });

    describe('Flow Execution', () => {
        it('should return error for non-existent flow', async () => {
            const result = await engine.execute('nonexistent');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('should execute a simple start → end flow', async () => {
            engine.registerFlow('simple', {
                name: 'simple',
                label: 'Simple',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'end' }],
            });

            const result = await engine.execute('simple');
            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('should execute nodes and collect output', async () => {
            engine.registerNodeExecutor({
                type: 'assignment',
                async execute(node, variables) {
                    variables.set('result', 42);
                    return { success: true };
                },
            });

            engine.registerFlow('with_assignment', {
                name: 'with_assignment',
                label: 'With Assignment',
                type: 'autolaunched',
                variables: [
                    { name: 'result', type: 'number', isOutput: true },
                ],
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'assign', type: 'assignment', label: 'Assign', config: { result: 42 } },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'assign' },
                    { id: 'e2', source: 'assign', target: 'end' },
                ],
            });

            const result = await engine.execute('with_assignment');
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ result: 42 });
        });

        it('should pass input variables from context', async () => {
            let capturedValue: unknown;

            engine.registerNodeExecutor({
                type: 'script',
                async execute(_node, variables) {
                    capturedValue = variables.get('input_val');
                    return { success: true };
                },
            });

            engine.registerFlow('input_test', {
                name: 'input_test',
                label: 'Input Test',
                type: 'autolaunched',
                variables: [
                    { name: 'input_val', type: 'text', isInput: true },
                ],
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'run', type: 'script', label: 'Run' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'run' },
                    { id: 'e2', source: 'run', target: 'end' },
                ],
            });

            await engine.execute('input_test', { params: { input_val: 'hello' } });
            expect(capturedValue).toBe('hello');
        });

        it('should inject $record from context', async () => {
            let capturedRecord: unknown;

            engine.registerNodeExecutor({
                type: 'script',
                async execute(_node, variables) {
                    capturedRecord = variables.get('$record');
                    return { success: true };
                },
            });

            engine.registerFlow('record_test', {
                name: 'record_test',
                label: 'Record Test',
                type: 'record_change',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'run', type: 'script', label: 'Run' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'run' },
                    { id: 'e2', source: 'run', target: 'end' },
                ],
            });

            await engine.execute('record_test', {
                record: { id: 'rec-1', name: 'Test' },
                object: 'account',
                event: 'on_create',
            });
            expect(capturedRecord).toEqual({ id: 'rec-1', name: 'Test' });
        });

        it('should fail when node executor is missing', async () => {
            engine.registerFlow('missing_executor', {
                name: 'missing_executor',
                label: 'Missing',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'unknown', type: 'get_record', label: 'Get' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'unknown' },
                    { id: 'e2', source: 'unknown', target: 'end' },
                ],
            });

            const result = await engine.execute('missing_executor');
            expect(result.success).toBe(false);
            expect(result.error).toContain('No executor registered');
        });

        it('should fail when flow has no start node', async () => {
            engine.registerFlow('no_start', {
                name: 'no_start',
                label: 'No Start',
                type: 'autolaunched',
                nodes: [
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [],
            });

            const result = await engine.execute('no_start');
            expect(result.success).toBe(false);
            expect(result.error).toContain('no start node');
        });

        it('should handle node execution failure', async () => {
            engine.registerNodeExecutor({
                type: 'script',
                async execute() {
                    return { success: false, error: 'Script timeout' };
                },
            });

            engine.registerFlow('failing_flow', {
                name: 'failing_flow',
                label: 'Failing',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'fail', type: 'script', label: 'Fail' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'fail' },
                    { id: 'e2', source: 'fail', target: 'end' },
                ],
            });

            const result = await engine.execute('failing_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Script timeout');
        });

        it('should follow conditional edges', async () => {
            const executed: string[] = [];

            engine.registerNodeExecutor({
                type: 'assignment',
                async execute(node) {
                    executed.push(node.id);
                    return { success: true };
                },
            });

            engine.registerFlow('branching', {
                name: 'branching',
                label: 'Branching',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'yes_branch', type: 'assignment', label: 'Yes' },
                    { id: 'no_branch', type: 'assignment', label: 'No' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'yes_branch', condition: 'true' },
                    { id: 'e2', source: 'start', target: 'no_branch', condition: 'false' },
                    { id: 'e3', source: 'yes_branch', target: 'end' },
                    { id: 'e4', source: 'no_branch', target: 'end' },
                ],
            });

            await engine.execute('branching');
            expect(executed).toContain('yes_branch');
            expect(executed).not.toContain('no_branch');
        });
    });

    describe('IAutomationService Contract', () => {
        it('should satisfy IAutomationService interface', () => {
            const service: IAutomationService = engine;
            expect(typeof service.execute).toBe('function');
            expect(typeof service.listFlows).toBe('function');
            expect(typeof service.registerFlow).toBe('function');
            expect(typeof service.unregisterFlow).toBe('function');
        });
    });
});

// ─── Plugin Integration Tests ────────────────────────────────────────

describe('AutomationServicePlugin (Kernel Integration)', () => {
    it('should register automation service via LiteKernel', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const service = kernel.getService<IAutomationService>('automation');
        expect(service).toBeDefined();
        expect(typeof service.execute).toBe('function');

        await kernel.shutdown();
    });

    it('should seed all built-in node executors from the core plugin alone', async () => {
        // ADR-0018: AutomationServicePlugin seeds the platform's built-in nodes
        // directly — no companion node-pack plugins required.
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');
        const nodeTypes = engine.getRegisteredNodeTypes();

        // CRUD nodes
        expect(nodeTypes).toContain('get_record');
        expect(nodeTypes).toContain('create_record');
        expect(nodeTypes).toContain('update_record');
        expect(nodeTypes).toContain('delete_record');

        // Logic nodes
        expect(nodeTypes).toContain('decision');
        expect(nodeTypes).toContain('assignment');
        expect(nodeTypes).toContain('loop');

        // Screen/Script nodes
        expect(nodeTypes).toContain('screen');
        expect(nodeTypes).toContain('script');

        // HTTP node (foundational I/O)
        expect(nodeTypes).toContain('http_request');

        // connector_action is an integration concern — NOT in the built-in baseline.
        expect(nodeTypes).not.toContain('connector_action');

        await kernel.shutdown();
    });

    it('should execute a flow end-to-end through kernel', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const automation = kernel.getService<IAutomationService>('automation');

        automation.registerFlow!('approval_flow', {
            name: 'approval_flow',
            label: 'Approval Flow',
            type: 'record_change',
            variables: [
                { name: 'status', type: 'text', isOutput: true },
            ],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'assign', type: 'assignment', label: 'Set Status', config: { status: 'approved' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'assign' },
                { id: 'e2', source: 'assign', target: 'end' },
            ],
        });

        const result = await automation.execute('approval_flow', {
            record: { id: 'rec-1', amount: 50000 },
            object: 'opportunity',
            event: 'on_create',
        });

        expect(result.success).toBe(true);
        expect(result.output).toEqual({ status: 'approved' });

        await kernel.shutdown();
    });
});

// ─── Hot-plug Tests ──────────────────────────────────────────────────

describe('Hot-plug Node Executor', () => {
    it('should allow adding new node types at runtime', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');
        // Built-ins are already seeded; a brand-new third-party type is absent.
        expect(engine.getRegisteredNodeTypes()).not.toContain('custom_node');

        // Hot-plug a third-party node type at runtime (marketplace extensibility).
        engine.registerNodeExecutor({
            type: 'custom_node',
            async execute() {
                return { success: true, output: { result: 'custom_script' } };
            },
        });

        expect(engine.getRegisteredNodeTypes()).toContain('custom_node');

        // Use it in a flow immediately — no restart needed
        engine.registerFlow('hotplug_flow', {
            name: 'hotplug_flow',
            label: 'Hot-plug Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'run_script', type: 'custom_node', label: 'Run Custom' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'run_script' },
                { id: 'e2', source: 'run_script', target: 'end' },
            ],
        });

        const result = await engine.execute('hotplug_flow');
        expect(result.success).toBe(true);

        await kernel.shutdown();
    });

    it('should allow removing node types at runtime', async () => {
        const engine = new AutomationEngine(createTestLogger());

        engine.registerNodeExecutor({
            type: 'temp_node',
            async execute() {
                return { success: true };
            },
        });
        expect(engine.getRegisteredNodeTypes()).toContain('temp_node');

        engine.unregisterNodeExecutor('temp_node');
        expect(engine.getRegisteredNodeTypes()).not.toContain('temp_node');
    });
});

// ─── Built-in CRUD Nodes Tests ───────────────────────────────────────

describe('Built-in CRUD nodes', () => {
    let engine: AutomationEngine;

    beforeEach(async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        engine = kernel.getService<AutomationEngine>('automation');
    });

    it('should register all CRUD node types', () => {
        const types = engine.getRegisteredNodeTypes();
        expect(types).toContain('get_record');
        expect(types).toContain('create_record');
        expect(types).toContain('update_record');
        expect(types).toContain('delete_record');
    });

    it('should execute get_record node successfully', async () => {
        engine.registerFlow('get_test', {
            name: 'get_test',
            label: 'Get Test',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'get', type: 'get_record', label: 'Get', config: { object: 'account' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'get' },
                { id: 'e2', source: 'get', target: 'end' },
            ],
        });

        const result = await engine.execute('get_test');
        expect(result.success).toBe(true);
    });
});

// ─── Built-in Logic Nodes Tests ──────────────────────────────────────

describe('Built-in logic nodes', () => {
    let engine: AutomationEngine;

    beforeEach(async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        engine = kernel.getService<AutomationEngine>('automation');
    });

    it('should register all logic node types', () => {
        const types = engine.getRegisteredNodeTypes();
        expect(types).toContain('decision');
        expect(types).toContain('assignment');
        expect(types).toContain('loop');
    });

    it('should execute assignment node and set variables', async () => {
        engine.registerFlow('assign_test', {
            name: 'assign_test',
            label: 'Assign Test',
            type: 'autolaunched',
            variables: [
                { name: 'greeting', type: 'text', isOutput: true },
            ],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'set', type: 'assignment', label: 'Set', config: { greeting: 'Hello World' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'set' },
                { id: 'e2', source: 'set', target: 'end' },
            ],
        });

        const result = await engine.execute('assign_test');
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ greeting: 'Hello World' });
    });
});

// ─── Built-in HTTP Node Tests ────────────────────────────────────────

describe('Built-in HTTP node', () => {
    let engine: AutomationEngine;

    beforeEach(async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        engine = kernel.getService<AutomationEngine>('automation');
    });

    it('should register the http_request node type', () => {
        const types = engine.getRegisteredNodeTypes();
        expect(types).toContain('http_request');
    });

    it('should NOT register connector_action in the built-in baseline', () => {
        // connector_action is an integration concern requiring a connector
        // registry the platform does not ship — left to the integration layer.
        expect(engine.getRegisteredNodeTypes()).not.toContain('connector_action');
    });
});

// ─── Execution History & Flow Management Tests ──────────────────────

describe('AutomationEngine - Execution History', () => {
    let engine: AutomationEngine;

    const simpleFlow = {
        name: 'test_flow',
        label: 'Test Flow',
        type: 'api' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    describe('getFlow', () => {
        it('should return the flow definition for a registered flow', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            const flow = await engine.getFlow('test_flow');
            expect(flow).not.toBeNull();
            expect(flow!.name).toBe('test_flow');
        });

        it('should return null for a non-existent flow', async () => {
            const flow = await engine.getFlow('non_existent');
            expect(flow).toBeNull();
        });
    });

    describe('toggleFlow', () => {
        it('should disable a flow', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.toggleFlow('test_flow', false);

            const result = await engine.execute('test_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('disabled');
        });

        it('should enable a disabled flow', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.toggleFlow('test_flow', false);
            await engine.toggleFlow('test_flow', true);

            const result = await engine.execute('test_flow');
            expect(result.success).toBe(true);
        });

        it('should throw for non-existent flow', async () => {
            await expect(engine.toggleFlow('missing', true)).rejects.toThrow('not found');
        });
    });

    describe('listRuns', () => {
        it('should return empty array when no runs exist', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            const runs = await engine.listRuns('test_flow');
            expect(runs).toHaveLength(0);
        });

        it('should return execution logs after running a flow', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.execute('test_flow');
            await engine.execute('test_flow');

            const runs = await engine.listRuns('test_flow');
            expect(runs).toHaveLength(2);
            expect(runs[0].status).toBe('completed');
        });

        it('should filter runs by flow name', async () => {
            engine.registerFlow('flow_a', { ...simpleFlow, name: 'flow_a' });
            engine.registerFlow('flow_b', { ...simpleFlow, name: 'flow_b' });
            await engine.execute('flow_a');
            await engine.execute('flow_b');
            await engine.execute('flow_a');

            const runsA = await engine.listRuns('flow_a');
            const runsB = await engine.listRuns('flow_b');
            expect(runsA).toHaveLength(2);
            expect(runsB).toHaveLength(1);
        });

        it('should respect limit option', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            for (let i = 0; i < 5; i++) {
                await engine.execute('test_flow');
            }

            const runs = await engine.listRuns('test_flow', { limit: 3 });
            expect(runs).toHaveLength(3);
        });
    });

    describe('getRun', () => {
        it('should return null for non-existent run', async () => {
            const run = await engine.getRun('non_existent');
            expect(run).toBeNull();
        });

        it('should return an execution log by run ID', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.execute('test_flow');

            const runs = await engine.listRuns('test_flow');
            const run = await engine.getRun(runs[0].id);
            expect(run).not.toBeNull();
            expect(run!.flowName).toBe('test_flow');
            expect(run!.status).toBe('completed');
        });
    });

    describe('execution log recording', () => {
        it('should record run ID and timing', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.execute('test_flow');

            const runs = await engine.listRuns('test_flow');
            expect(runs[0].id).toMatch(/^run_/);
            expect(runs[0].startedAt).toBeTruthy();
            expect(runs[0].completedAt).toBeTruthy();
            expect(typeof runs[0].durationMs).toBe('number');
        });

        it('should record failed executions', async () => {
            const failingFlow = {
                ...simpleFlow,
                name: 'failing_flow',
                nodes: [
                    { id: 'start', type: 'start' as const, label: 'Start' },
                    { id: 'bad', type: 'script' as const, label: 'Bad' },
                    { id: 'end', type: 'end' as const, label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'bad' },
                    { id: 'e2', source: 'bad', target: 'end' },
                ],
            };
            engine.registerFlow('failing_flow', failingFlow);
            await engine.execute('failing_flow');

            const runs = await engine.listRuns('failing_flow');
            expect(runs).toHaveLength(1);
            expect(runs[0].status).toBe('failed');
            expect(runs[0].error).toBeTruthy();
        });

        it('should record trigger context', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.execute('test_flow', {
                event: 'on_create',
                userId: 'user_1',
                object: 'account',
            });

            const runs = await engine.listRuns('test_flow');
            expect(runs[0].trigger.type).toBe('on_create');
            expect(runs[0].trigger.userId).toBe('user_1');
            expect(runs[0].trigger.object).toBe('account');
        });
    });

    describe('unregisterFlow cleans up enabled state', () => {
        it('should remove enabled state on unregister', async () => {
            engine.registerFlow('test_flow', simpleFlow);
            await engine.toggleFlow('test_flow', false);
            engine.unregisterFlow('test_flow');

            // Re-register should default to enabled
            engine.registerFlow('test_flow', simpleFlow);
            const result = await engine.execute('test_flow');
            expect(result.success).toBe(true);
        });
    });
});

// ─── Fault Edge Tests ────────────────────────────────────────────────

describe('AutomationEngine - Fault Edge Support', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should follow fault edge when node fails', async () => {
        const executed: string[] = [];

        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'risky') {
                    return { success: false, error: 'Script crashed' };
                }
                executed.push(node.id);
                return { success: true };
            },
        });

        engine.registerFlow('fault_flow', {
            name: 'fault_flow',
            label: 'Fault Flow',
            type: 'autolaunched',
            variables: [{ name: 'status', type: 'text', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'risky', type: 'script', label: 'Risky' },
                { id: 'handler', type: 'script', label: 'Error Handler' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        const result = await engine.execute('fault_flow');
        expect(result.success).toBe(true);
        expect(executed).toContain('handler');
    });

    it('should write error info to $error variable on fault path', async () => {
        let capturedError: unknown;

        engine.registerNodeExecutor({
            type: 'script',
            async execute(node, variables) {
                if (node.id === 'risky') {
                    return { success: false, error: 'Something went wrong' };
                }
                capturedError = variables.get('$error');
                return { success: true };
            },
        });

        engine.registerFlow('fault_error_ctx', {
            name: 'fault_error_ctx',
            label: 'Fault Error Context',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'risky', type: 'script', label: 'Risky' },
                { id: 'handler', type: 'script', label: 'Handler' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        await engine.execute('fault_error_ctx');
        expect(capturedError).toBeDefined();
        expect((capturedError as any).message).toBe('Something went wrong');
    });

    it('should throw when no fault edge and node fails', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                return { success: false, error: 'Fatal error' };
            },
        });

        engine.registerFlow('no_fault', {
            name: 'no_fault',
            label: 'No Fault',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'fail', type: 'script', label: 'Fail' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'fail' },
                { id: 'e2', source: 'fail', target: 'end' },
            ],
        });

        const result = await engine.execute('no_fault');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Fatal error');
    });
});

// ─── Step-Level Execution Log Tests ──────────────────────────────────

describe('AutomationEngine - Step-Level Execution Logs', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should record step logs with timing for each node', async () => {
        engine.registerNodeExecutor({
            type: 'assignment',
            async execute(node, variables) {
                const config = (node.config ?? {}) as Record<string, unknown>;
                for (const [key, value] of Object.entries(config)) {
                    variables.set(key, value);
                }
                return { success: true };
            },
        });

        engine.registerFlow('step_log_flow', {
            name: 'step_log_flow',
            label: 'Step Log Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'assign', type: 'assignment', label: 'Assign', config: { x: 1 } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'assign' },
                { id: 'e2', source: 'assign', target: 'end' },
            ],
        });

        await engine.execute('step_log_flow');
        const runs = await engine.listRuns('step_log_flow');
        expect(runs).toHaveLength(1);
        expect(runs[0].steps.length).toBeGreaterThanOrEqual(2); // start + assign
        expect(runs[0].steps[0].status).toBe('success');
        expect(runs[0].steps[0].startedAt).toBeTruthy();
        expect(typeof runs[0].steps[0].durationMs).toBe('number');
    });

    it('should record failure step in logs when node fails', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                return { success: false, error: 'Bad script' };
            },
        });

        engine.registerFlow('fail_step_log', {
            name: 'fail_step_log',
            label: 'Fail Step Log',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'bad', type: 'script', label: 'Bad' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'bad' },
                { id: 'e2', source: 'bad', target: 'end' },
            ],
        });

        await engine.execute('fail_step_log');
        const runs = await engine.listRuns('fail_step_log');
        expect(runs).toHaveLength(1);
        const failStep = runs[0].steps.find(s => s.nodeId === 'bad');
        expect(failStep).toBeDefined();
        expect(failStep!.status).toBe('failure');
        expect(failStep!.error).toBeDefined();
    });

    it('should record flowVersion in execution log', async () => {
        engine.registerFlow('versioned_flow', {
            name: 'versioned_flow',
            label: 'Versioned',
            type: 'autolaunched',
            version: 5,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });

        await engine.execute('versioned_flow');
        const runs = await engine.listRuns('versioned_flow');
        expect(runs[0].flowVersion).toBe(5);
    });
});

// ─── DAG Cycle Detection Tests ───────────────────────────────────────

describe('AutomationEngine - DAG Cycle Detection', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should reject flows with cycles', () => {
        expect(() => engine.registerFlow('cyclic_flow', {
            name: 'cyclic_flow',
            label: 'Cyclic Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'a', type: 'start', label: 'A' },
                { id: 'b', type: 'assignment', label: 'B' },
                { id: 'c', type: 'assignment', label: 'C' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b' },
                { id: 'e2', source: 'b', target: 'c' },
                { id: 'e3', source: 'c', target: 'b' }, // cycle: b → c → b
            ],
        })).toThrow(/cycle/i);
    });

    it('should accept valid DAG flows', () => {
        expect(() => engine.registerFlow('valid_dag', {
            name: 'valid_dag',
            label: 'Valid DAG',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'a', type: 'assignment', label: 'A' },
                { id: 'b', type: 'assignment', label: 'B' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'a' },
                { id: 'e2', source: 'start', target: 'b' },
                { id: 'e3', source: 'a', target: 'end' },
                { id: 'e4', source: 'b', target: 'end' },
            ],
        })).not.toThrow();
    });

    it('should provide cycle details in error message', () => {
        try {
            engine.registerFlow('detailed_cycle', {
                name: 'detailed_cycle',
                label: 'Detailed Cycle',
                type: 'autolaunched',
                nodes: [
                    { id: 'x', type: 'start', label: 'X' },
                    { id: 'y', type: 'assignment', label: 'Y' },
                    { id: 'z', type: 'assignment', label: 'Z' },
                ],
                edges: [
                    { id: 'e1', source: 'x', target: 'y' },
                    { id: 'e2', source: 'y', target: 'z' },
                    { id: 'e3', source: 'z', target: 'y' },
                ],
            });
            expect.fail('Should have thrown');
        } catch (err: any) {
            expect(err.message).toContain('→');
            expect(err.message).toContain('DAG');
        }
    });
});

// ─── Node Timeout Tests ──────────────────────────────────────────────

describe('AutomationEngine - Node Timeout', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should timeout a slow node', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                await new Promise(r => setTimeout(r, 5000)); // 5 seconds
                return { success: true };
            },
        });

        engine.registerFlow('timeout_flow', {
            name: 'timeout_flow',
            label: 'Timeout Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'slow', type: 'script', label: 'Slow', timeoutMs: 50 },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'slow' },
                { id: 'e2', source: 'slow', target: 'end' },
            ],
        });

        const result = await engine.execute('timeout_flow');
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

    it('should succeed when node completes within timeout', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                return { success: true };
            },
        });

        engine.registerFlow('fast_flow', {
            name: 'fast_flow',
            label: 'Fast Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'fast', type: 'script', label: 'Fast', timeoutMs: 5000 },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'fast' },
                { id: 'e2', source: 'fast', target: 'end' },
            ],
        });

        const result = await engine.execute('fast_flow');
        expect(result.success).toBe(true);
    });
});

// ─── Safe Expression Evaluation Tests ────────────────────────────────

describe('AutomationEngine - Safe Expression Evaluation', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should evaluate simple comparisons', () => {
        const vars = new Map<string, unknown>();
        vars.set('amount', 500);

        expect(engine.evaluateCondition('{amount} > 100', vars)).toBe(true);
        expect(engine.evaluateCondition('{amount} < 100', vars)).toBe(false);
        expect(engine.evaluateCondition('{amount} == 500', vars)).toBe(true);
        expect(engine.evaluateCondition('{amount} >= 500', vars)).toBe(true);
        expect(engine.evaluateCondition('{amount} <= 500', vars)).toBe(true);
        expect(engine.evaluateCondition('{amount} != 100', vars)).toBe(true);
    });

    it('should evaluate boolean literals', () => {
        const vars = new Map<string, unknown>();
        expect(engine.evaluateCondition('true', vars)).toBe(true);
        expect(engine.evaluateCondition('false', vars)).toBe(false);
    });

    it('should not execute malicious code', () => {
        const vars = new Map<string, unknown>();
        // These should all return false safely
        expect(engine.evaluateCondition('process.exit(1)', vars)).toBe(false);
        expect(engine.evaluateCondition('require("fs").readFileSync("/etc/passwd")', vars)).toBe(false);
        expect(engine.evaluateCondition('(() => { while(true) {} })()', vars)).toBe(false);
    });

    it('should handle string comparisons', () => {
        const vars = new Map<string, unknown>();
        vars.set('status', 'active');

        expect(engine.evaluateCondition('{status} == active', vars)).toBe(true);
        expect(engine.evaluateCondition('{status} != inactive', vars)).toBe(true);
    });
});

// ─── Parallel Branch Execution Tests ─────────────────────────────────

describe('AutomationEngine - Parallel Branch Execution', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should execute unconditional branches in parallel', async () => {
        const executionOrder: string[] = [];

        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                const delay = (node.config as any)?.delay ?? 0;
                await new Promise(r => setTimeout(r, delay));
                executionOrder.push(node.id);
                return { success: true };
            },
        });

        engine.registerFlow('parallel_flow', {
            name: 'parallel_flow',
            label: 'Parallel Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'branch_a', type: 'script', label: 'Branch A', config: { delay: 10 } },
                { id: 'branch_b', type: 'script', label: 'Branch B', config: { delay: 10 } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'branch_a' },
                { id: 'e2', source: 'start', target: 'branch_b' },
                { id: 'e3', source: 'branch_a', target: 'end' },
                { id: 'e4', source: 'branch_b', target: 'end' },
            ],
        });

        const start = Date.now();
        const result = await engine.execute('parallel_flow');
        const elapsed = Date.now() - start;

        expect(result.success).toBe(true);
        // Both branches should execute (order may vary in parallel)
        expect(executionOrder).toContain('branch_a');
        expect(executionOrder).toContain('branch_b');
        // Parallel execution should be faster than sequential (10+10=20ms)
        // Allow generous margin but expect it's faster than fully sequential
        expect(elapsed).toBeLessThan(100); // generous but parallel should be ~15ms
    });
});

// ─── Input Schema Validation Tests ───────────────────────────────────

describe('AutomationEngine - Node Input Schema Validation', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should fail when required input parameter is missing', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                return { success: true };
            },
        });

        engine.registerFlow('schema_fail', {
            name: 'schema_fail',
            label: 'Schema Fail',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'validated',
                    type: 'script',
                    label: 'Validated',
                    config: {},
                    inputSchema: {
                        url: { type: 'string', required: true, description: 'URL to call' },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'validated' },
                { id: 'e2', source: 'validated', target: 'end' },
            ],
        });

        const result = await engine.execute('schema_fail');
        expect(result.success).toBe(false);
        expect(result.error).toContain('missing required');
    });

    it('should fail when parameter type is wrong', async () => {
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                return { success: true };
            },
        });

        engine.registerFlow('type_fail', {
            name: 'type_fail',
            label: 'Type Fail',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'validated',
                    type: 'script',
                    label: 'Validated',
                    config: { count: 'not_a_number' },
                    inputSchema: {
                        count: { type: 'number', required: true },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'validated' },
                { id: 'e2', source: 'validated', target: 'end' },
            ],
        });

        const result = await engine.execute('type_fail');
        expect(result.success).toBe(false);
        expect(result.error).toContain('expected type');
    });
});

// ─── Flow Version Management Tests ───────────────────────────────────

describe('AutomationEngine - Flow Version Management', () => {
    let engine: AutomationEngine;

    const makeFlow = (version: number, label: string) => ({
        name: 'versioned_flow',
        label,
        type: 'autolaunched' as const,
        version,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should keep version history on registerFlow', () => {
        engine.registerFlow('versioned_flow', makeFlow(1, 'V1'));
        engine.registerFlow('versioned_flow', makeFlow(2, 'V2'));
        engine.registerFlow('versioned_flow', makeFlow(3, 'V3'));

        const history = engine.getFlowVersionHistory('versioned_flow');
        expect(history).toHaveLength(3);
        expect(history[0].version).toBe(1);
        expect(history[2].version).toBe(3);
    });

    it('should rollback to a previous version', async () => {
        engine.registerFlow('versioned_flow', makeFlow(1, 'V1'));
        engine.registerFlow('versioned_flow', makeFlow(2, 'V2'));

        const current = await engine.getFlow('versioned_flow');
        expect(current!.label).toBe('V2');

        engine.rollbackFlow('versioned_flow', 1);
        const rolledBack = await engine.getFlow('versioned_flow');
        expect(rolledBack!.label).toBe('V1');
    });

    it('should throw when rolling back to non-existent version', () => {
        engine.registerFlow('versioned_flow', makeFlow(1, 'V1'));
        expect(() => engine.rollbackFlow('versioned_flow', 99)).toThrow('Version 99 not found');
    });

    it('should throw when rolling back non-existent flow', () => {
        expect(() => engine.rollbackFlow('nonexistent', 1)).toThrow('no version history');
    });

    it('should clean up version history on unregister', () => {
        engine.registerFlow('versioned_flow', makeFlow(1, 'V1'));
        engine.unregisterFlow('versioned_flow');
        const history = engine.getFlowVersionHistory('versioned_flow');
        expect(history).toHaveLength(0);
    });
});

// ─── Execution Status Expansion Tests ────────────────────────────────

describe('AutomationEngine - Execution Status', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('should record completed status for successful execution', async () => {
        engine.registerFlow('status_flow', {
            name: 'status_flow',
            label: 'Status Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });

        await engine.execute('status_flow');
        const runs = await engine.listRuns('status_flow');
        expect(runs[0].status).toBe('completed');
    });

    it('should record failed status for failed execution', async () => {
        engine.registerFlow('fail_status', {
            name: 'fail_status',
            label: 'Fail Status',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'bad', type: 'script', label: 'Bad' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'bad' },
                { id: 'e2', source: 'bad', target: 'end' },
            ],
        });

        await engine.execute('fail_status');
        const runs = await engine.listRuns('fail_status');
        expect(runs[0].status).toBe('failed');
    });
});

// ─── ADR-0018: Action Descriptor Registry & Open Node Types ──────────

describe('Action Descriptor Registry (ADR-0018)', () => {
    /** Logger that records warn() messages so we can assert soft-validation. */
    function createCapturingLogger(warnings: string[]) {
        const logger: any = {
            info: () => {},
            warn: (msg: string) => warnings.push(msg),
            error: () => {},
            debug: () => {},
            child: () => logger,
        };
        return logger;
    }

    const baseFlow = (type: string) => ({
        name: 'plugin_node_flow',
        label: 'Plugin Node Flow',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'custom', type, label: 'Custom' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'custom' },
            { id: 'e2', source: 'custom', target: 'end' },
        ],
    });

    it('accepts a flow whose node type is a plugin-registered executor (the core bug fix)', () => {
        const warnings: string[] = [];
        const engine = new AutomationEngine(createCapturingLogger(warnings));

        // A brand-new, non-built-in node type — previously rejected by the
        // closed FlowNodeAction enum. Now legal because the executor is registered.
        engine.registerNodeExecutor({
            type: 'send_sms',
            async execute() { return { success: true }; },
        });

        expect(() => engine.registerFlow('plugin_node_flow', baseFlow('send_sms'))).not.toThrow();
        // No "unknown node type" warning for a registered executor.
        expect(warnings.some(w => w.includes('send_sms'))).toBe(false);
    });

    it('registers the flow but warns when a node type has no executor or descriptor', () => {
        const warnings: string[] = [];
        const engine = new AutomationEngine(createCapturingLogger(warnings));

        // Soft-fail per ADR-0018: register but warn (a temporarily-absent
        // plugin should not block flow registration).
        expect(() => engine.registerFlow('plugin_node_flow', baseFlow('not_a_real_type'))).not.toThrow();
        expect(warnings.some(w => w.includes('not_a_real_type'))).toBe(true);
    });

    it('does not warn for the structural start/end node types', () => {
        const warnings: string[] = [];
        const engine = new AutomationEngine(createCapturingLogger(warnings));
        engine.registerFlow('struct_only', {
            name: 'struct_only',
            label: 'Struct Only',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
        expect(warnings.filter(w => w.includes('no registered executor'))).toHaveLength(0);
    });

    it('publishes a descriptor into the registry when an executor declares one', () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerNodeExecutor({
            type: 'send_sms',
            descriptor: {
                type: 'send_sms',
                version: '2.1.0',
                name: 'Send SMS',
                category: 'io',
                paradigms: ['flow'],
                supportsPause: false,
                supportsCancellation: false,
                supportsRetry: true,
                needsOutbox: true,
                isAsync: false,
                source: 'plugin',
                deprecated: false,
            },
            async execute() { return { success: true }; },
        });

        const descriptor = engine.getActionDescriptor('send_sms');
        expect(descriptor).toBeDefined();
        expect(descriptor?.name).toBe('Send SMS');
        expect(descriptor?.category).toBe('io');
        expect(descriptor?.needsOutbox).toBe(true);
        expect(engine.getActionDescriptors().map(d => d.type)).toContain('send_sms');
    });

    it('drops the published descriptor on unregister', () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerNodeExecutor({
            type: 'send_sms',
            descriptor: {
                type: 'send_sms', version: '1.0.0', name: 'Send SMS',
                category: 'io', paradigms: ['flow'], supportsPause: false,
                supportsCancellation: false, supportsRetry: true,
                needsOutbox: false, isAsync: false, source: 'plugin', deprecated: false,
            },
            async execute() { return { success: true }; },
        });
        expect(engine.getActionDescriptor('send_sms')).toBeDefined();
        engine.unregisterNodeExecutor('send_sms');
        expect(engine.getActionDescriptor('send_sms')).toBeUndefined();
        expect(engine.getActionDescriptors()).toHaveLength(0);
    });

    it('built-in nodes publish descriptors through the engine registry (core plugin alone)', async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const automation = kernel.getService('automation') as IAutomationService & {
            getActionDescriptors(): Array<{ type: string; category: string; source: string }>;
        };
        const descriptors = automation.getActionDescriptors();
        const byType = new Map(descriptors.map(d => [d.type, d]));

        expect(byType.has('decision')).toBe(true);
        expect(byType.get('decision')?.category).toBe('logic');
        expect(byType.get('create_record')?.category).toBe('data');
        expect(byType.get('http_request')?.category).toBe('io');

        // All built-ins are tagged source: 'builtin'.
        expect(byType.get('decision')?.source).toBe('builtin');
        expect(byType.get('http_request')?.source).toBe('builtin');
    });
});
