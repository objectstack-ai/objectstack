// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine, DEFAULT_MAX_EXECUTION_LOG_SIZE } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import { registerScreenNodes } from './builtin/screen-nodes.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
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

    describe('Execution-log ring buffer (P1-2)', () => {
        it('defaults the cap to DEFAULT_MAX_EXECUTION_LOG_SIZE', () => {
            const e = new AutomationEngine(createTestLogger());
            expect(DEFAULT_MAX_EXECUTION_LOG_SIZE).toBeGreaterThan(0);
            expect((e as unknown as { maxLogSize: number }).maxLogSize).toBe(
                DEFAULT_MAX_EXECUTION_LOG_SIZE,
            );
        });

        it('honours a configured maxLogSize and evicts oldest beyond it', async () => {
            const e = new AutomationEngine(createTestLogger(), undefined, { maxLogSize: 3 });
            expect((e as unknown as { maxLogSize: number }).maxLogSize).toBe(3);

            // Drive the private ring buffer directly: push 5, keep newest 3.
            const rec = (e as any).recordLog.bind(e);
            for (let i = 0; i < 5; i++) {
                rec({ id: `run_${i}`, flowName: 'f', status: 'success' });
            }
            const buf = (e as unknown as { executionLogs: Array<{ id: string }> }).executionLogs;
            expect(buf).toHaveLength(3);
            expect(buf.map((l) => l.id)).toEqual(['run_2', 'run_3', 'run_4']);
        });
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

        // ADR-0032 §Decision 1a — a malformed condition (the #1491 `{record.x}`
        // template-brace-in-CEL mistake) is rejected LOUDLY at registration, with
        // the offending location + source + a corrective hint — not silently at
        // run time.
        it('rejects a brace-in-CEL condition at registration — #1491 (Decision 1a)', () => {
            const register = () =>
                engine.registerFlow('bad_condition', {
                    name: 'bad_condition',
                    label: 'Bad Condition',
                    type: 'record_change',
                    nodes: [
                        { id: 'check', type: 'decision', label: 'Check', config: { condition: '{record.rating} >= 4' } },
                        { id: 'start', type: 'start', label: 'Start' },
                        { id: 'end', type: 'end', label: 'End' },
                    ],
                    edges: [
                        { id: 'e1', source: 'start', target: 'check' },
                        { id: 'e2', source: 'check', target: 'end', condition: '{record.rating} >= 4' },
                    ],
                });
            expect(register).toThrow(/\{record\.rating\} >= 4/);
            expect(register).toThrow(/template braces|bare CEL/);
        });

        // ADR-0032 §Decision 1c — defense in depth: if a malformed predicate ever
        // reaches the runtime evaluator (bypassing registration validation), it
        // THROWS an attributed error rather than swallowing to `false`.
        it('evaluateCondition throws (never returns false) on a malformed CEL predicate — Decision 1c', () => {
            const vars = new Map<string, unknown>([['record', { rating: 5 }]]);
            expect(() => engine.evaluateCondition({ dialect: 'cel', source: '{record.rating} >= 4' }, vars))
                .toThrow(/source:|template braces|bare CEL/);
        });

        // ADR-0032 §1c / #1534 — numeric fields that serialize as strings
        // (`Field.rating` → `"5.0"`, `Field.currency` → `"250000.00"`) used to
        // fault under strict CEL (`no such overload: dyn >= int`) and silently
        // dead-end the flow at the decision node. The condition must now compare
        // as a number so the matching edge is taken.
        it('takes a decision edge gated on a string-serialized numeric field — #1534', async () => {
            const vars = new Map<string, unknown>([['record', { rating: '5.0', amount: '250000.00' }]]);
            expect(engine.evaluateCondition({ dialect: 'cel', source: 'record.rating >= 4' }, vars)).toBe(true);
            expect(engine.evaluateCondition({ dialect: 'cel', source: 'record.amount > 100000' }, vars)).toBe(true);
            expect(engine.evaluateCondition({ dialect: 'cel', source: 'record.rating >= 4' },
                new Map([['record', { rating: '2.5' }]]))).toBe(false);
        });

        it('routes through a decision instead of dead-ending when rating is "5.0" — #1534', async () => {
            const executed: string[] = [];
            engine.registerNodeExecutor({
                type: 'decision',
                async execute() { return { success: true }; },
            });
            engine.registerNodeExecutor({
                type: 'assignment',
                async execute(node) {
                    executed.push(node.id);
                    return { success: true };
                },
            });

            engine.registerFlow('hot_lead', {
                name: 'hot_lead',
                label: 'Hot Lead Routing',
                type: 'record_change',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'check', type: 'decision', label: 'Check' },
                    { id: 'hot', type: 'assignment', label: 'Hot' },
                    { id: 'cold', type: 'assignment', label: 'Cold' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'check' },
                    { id: 'e2', source: 'check', target: 'hot', condition: 'record.rating >= 4' },
                    { id: 'e3', source: 'check', target: 'cold', condition: 'record.rating < 4' },
                    { id: 'e4', source: 'hot', target: 'end' },
                    { id: 'e5', source: 'cold', target: 'end' },
                ],
            });

            const result = await engine.execute('hot_lead', { record: { rating: '5.0' }, object: 'crm_lead' });
            expect(result.success).toBe(true);
            expect(executed).toContain('hot');
            expect(executed).not.toContain('cold');
        });
    });

    describe('Durable Suspend / Resume (ADR-0019)', () => {
        // A node that pauses the run on entry, exposing the run id it captured.
        function registerPausingNode(captured: { runId?: unknown }) {
            engine.registerNodeExecutor({
                type: 'pause_node',
                async execute(_node, variables) {
                    captured.runId = variables.get('$runId');
                    return { success: true, suspend: true, correlation: 'req_1' };
                },
            });
        }

        it('should suspend at a pausing node and return { status: "paused", runId }', async () => {
            const captured: { runId?: unknown } = {};
            registerPausingNode(captured);
            engine.registerNodeExecutor({
                type: 'after',
                async execute() { return { success: true }; },
            });

            engine.registerFlow('pause_flow', {
                name: 'pause_flow',
                label: 'Pause Flow',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'pause', type: 'pause_node', label: 'Pause' },
                    { id: 'after', type: 'after', label: 'After' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'pause' },
                    { id: 'e2', source: 'pause', target: 'after' },
                    { id: 'e3', source: 'after', target: 'end' },
                ],
            });

            const result = await engine.execute('pause_flow');
            expect(result.success).toBe(true);
            expect(result.status).toBe('paused');
            expect(result.runId).toBeDefined();
            // Run id was injected into the variable context for the node.
            expect(captured.runId).toBe(result.runId);

            // It appears in the suspended-runs listing with its correlation.
            const suspended = engine.listSuspendedRuns();
            expect(suspended).toHaveLength(1);
            expect(suspended[0]).toMatchObject({
                runId: result.runId,
                flowName: 'pause_flow',
                nodeId: 'pause',
                correlation: 'req_1',
            });
        });

        it('should continue downstream nodes on resume', async () => {
            const executed: string[] = [];
            const captured: { runId?: unknown } = {};
            registerPausingNode(captured);
            engine.registerNodeExecutor({
                type: 'after',
                async execute(node) { executed.push(node.id); return { success: true }; },
            });

            engine.registerFlow('resume_flow', {
                name: 'resume_flow',
                label: 'Resume Flow',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'pause', type: 'pause_node', label: 'Pause' },
                    { id: 'after', type: 'after', label: 'After' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'pause' },
                    { id: 'e2', source: 'pause', target: 'after' },
                    { id: 'e3', source: 'after', target: 'end' },
                ],
            });

            const paused = await engine.execute('resume_flow');
            expect(executed).not.toContain('after');

            const resumed = await engine.resume(paused.runId!);
            expect(resumed.success).toBe(true);
            expect(resumed.status).toBeUndefined();
            expect(executed).toContain('after');
            // The suspension is consumed exactly once.
            expect(engine.listSuspendedRuns()).toHaveLength(0);
        });

        // ── Screen-flow runtime (interactive `screen` nodes) ──
        const fakeScreenCtx = () => ({ logger: { info() {}, warn() {}, error() {} } }) as any;

        it('suspends at a screen with fields, surfaces the spec, and resume sets bare vars', async () => {
            registerScreenNodes(engine, fakeScreenCtx());
            let captured: unknown = 'UNSET';
            engine.registerNodeExecutor({
                type: 'capture',
                async execute(_node, variables) { captured = variables.get('new_assignee'); return { success: true }; },
            });
            engine.registerFlow('screen_flow', {
                name: 'screen_flow', label: 'Screen Flow', type: 'screen',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'collect', type: 'screen', label: 'New Assignee', config: { fields: [{ name: 'new_assignee', label: 'New Assignee', type: 'text', required: true }] } },
                    { id: 'apply', type: 'capture', label: 'Apply' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'collect' },
                    { id: 'e2', source: 'collect', target: 'apply' },
                    { id: 'e3', source: 'apply', target: 'end' },
                ],
            });

            const paused = await engine.execute('screen_flow');
            expect(paused.status).toBe('paused');
            expect(paused.screen).toMatchObject({ nodeId: 'collect', title: 'New Assignee' });
            expect(paused.screen!.fields[0]).toMatchObject({ name: 'new_assignee', required: true, type: 'text' });
            expect(captured).toBe('UNSET'); // downstream not run yet
            // Re-fetchable for a refreshed client.
            expect(engine.getSuspendedScreen(paused.runId!)).toMatchObject({ nodeId: 'collect' });

            const done = await engine.resume(paused.runId!, { variables: { new_assignee: 'ada@example.com' } });
            expect(done.success).toBe(true);
            expect(done.status).toBeUndefined();
            expect(captured).toBe('ada@example.com'); // bare var set on resume → downstream read it
            expect(engine.getSuspendedScreen(paused.runId!)).toBeNull();
        });

        it('passes a field-less screen straight through (no pause)', async () => {
            registerScreenNodes(engine, fakeScreenCtx());
            engine.registerFlow('passthrough_screen', {
                name: 'passthrough_screen', label: 'Passthrough', type: 'screen',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 's', type: 'screen', label: 'noop', config: {} },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 's' }, { id: 'e2', source: 's', target: 'end' }],
            });
            const r = await engine.execute('passthrough_screen');
            expect(r.success).toBe(true);
            expect(r.status).toBeUndefined();
        });

        it('should select the branch named by the resume signal label', async () => {
            const executed: string[] = [];
            const captured: { runId?: unknown } = {};
            registerPausingNode(captured);
            engine.registerNodeExecutor({
                type: 'branch_node',
                async execute(node) { executed.push(node.id); return { success: true }; },
            });

            engine.registerFlow('decision_flow', {
                name: 'decision_flow',
                label: 'Decision Flow',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'pause', type: 'pause_node', label: 'Approval' },
                    { id: 'approved', type: 'branch_node', label: 'Approved' },
                    { id: 'rejected', type: 'branch_node', label: 'Rejected' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'pause' },
                    { id: 'e2', source: 'pause', target: 'approved', label: 'approve' },
                    { id: 'e3', source: 'pause', target: 'rejected', label: 'reject' },
                    { id: 'e4', source: 'approved', target: 'end' },
                    { id: 'e5', source: 'rejected', target: 'end' },
                ],
            });

            const paused = await engine.execute('decision_flow');
            await engine.resume(paused.runId!, { branchLabel: 'approve', output: { decision: 'approved' } });

            expect(executed).toContain('approved');
            expect(executed).not.toContain('rejected');
        });

        it('should fail to resume an unknown run', async () => {
            const result = await engine.resume('run_does_not_exist');
            expect(result.success).toBe(false);
            expect(result.error).toContain('No suspended run');
        });

        it('should opt-in screen node into suspend via config.waitForInput', async () => {
            const kernel = new LiteKernel();
            kernel.use(new AutomationServicePlugin());
            await kernel.bootstrap();
            const e = kernel.getService<AutomationEngine>('automation');

            e.registerFlow('screen_wait', {
                name: 'screen_wait',
                label: 'Screen Wait',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'screen', type: 'screen', label: 'Screen', config: { waitForInput: true } },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'screen' },
                    { id: 'e2', source: 'screen', target: 'end' },
                ],
            });

            const paused = await e.execute('screen_wait');
            expect(paused.status).toBe('paused');

            const resumed = await e.resume(paused.runId!);
            expect(resumed.success).toBe(true);
            expect(resumed.status).toBeUndefined();
        });

        // ── Durable persistence across a process restart (ADR-0019) ──
        //
        // A shared SuspendedRunStore stands in for a database: suspend on one
        // engine instance, then resume on a brand-new instance backed by the
        // same store — simulating a cold boot after the original process is gone.
        describe('Durable persistence across process restart', () => {
            function buildEngine(
                store: InMemorySuspendedRunStore,
                captured: { snapshot?: unknown; ran: string[] },
            ) {
                const e = new AutomationEngine(createTestLogger(), store);
                e.registerNodeExecutor({
                    type: 'pause_node',
                    async execute() {
                        // Snapshot a nested object + array so we can assert the
                        // variable map round-trips through the store.
                        return {
                            success: true,
                            suspend: true,
                            correlation: 'req_1',
                            output: { snapshot: { nested: { value: 42 }, arr: [1, 2, 3] } },
                        };
                    },
                });
                e.registerNodeExecutor({
                    type: 'branch_node',
                    async execute(node, variables) {
                        captured.ran.push(node.id);
                        captured.snapshot = variables.get('pause.snapshot');
                        return { success: true };
                    },
                });
                e.registerFlow('approval_flow', {
                    name: 'approval_flow', label: 'Approval Flow', type: 'autolaunched',
                    nodes: [
                        { id: 'start', type: 'start', label: 'Start' },
                        { id: 'pause', type: 'pause_node', label: 'Approval' },
                        { id: 'approved', type: 'branch_node', label: 'Approved' },
                        { id: 'rejected', type: 'branch_node', label: 'Rejected' },
                        { id: 'end', type: 'end', label: 'End' },
                    ],
                    edges: [
                        { id: 'e1', source: 'start', target: 'pause' },
                        { id: 'e2', source: 'pause', target: 'approved', label: 'approve' },
                        { id: 'e3', source: 'pause', target: 'rejected', label: 'reject' },
                        { id: 'e4', source: 'approved', target: 'end' },
                        { id: 'e5', source: 'rejected', target: 'end' },
                    ],
                });
                return e;
            }

            it('survives a full restart: suspend on one engine, resume on a fresh one', async () => {
                const store = new InMemorySuspendedRunStore();

                // Process lifetime #1 — the run suspends at the approval node.
                const a = { snapshot: undefined as unknown, ran: [] as string[] };
                const engineA = buildEngine(store, a);
                const paused = await engineA.execute('approval_flow');
                expect(paused.status).toBe('paused');
                expect(paused.runId).toBeDefined();
                expect(await store.list()).toHaveLength(1);

                // Process lifetime #2 — a brand-new engine cold-boots. The run is
                // NOT in its in-memory cache…
                const b = { snapshot: undefined as unknown, ran: [] as string[] };
                const engineB = buildEngine(store, b);
                expect(engineB.listSuspendedRuns()).toHaveLength(0);
                // …but it is visible and resumable via the durable store.
                const durable = await engineB.listSuspendedRunsDurable();
                expect(durable).toHaveLength(1);
                expect(durable[0]).toMatchObject({
                    runId: paused.runId, flowName: 'approval_flow', nodeId: 'pause', correlation: 'req_1',
                });

                const resumed = await engineB.resume(paused.runId!, {
                    branchLabel: 'approve', output: { decision: 'approved' },
                });
                expect(resumed.success).toBe(true);
                expect(resumed.status).toBeUndefined();
                // Continued down the correct branch on the fresh engine.
                expect(b.ran).toContain('approved');
                expect(b.ran).not.toContain('rejected');
                // Variables (nested object + array) round-tripped through the store.
                expect(b.snapshot).toEqual({ nested: { value: 42 }, arr: [1, 2, 3] });
                // The durable record is consumed on terminal completion.
                expect(await store.list()).toHaveLength(0);
                expect(await engineB.listSuspendedRunsDurable()).toHaveLength(0);
            });

            it('resume is idempotent: a duplicate resume does not double-run downstream', async () => {
                const store = new InMemorySuspendedRunStore();
                const a = { snapshot: undefined as unknown, ran: [] as string[] };
                const engineA = buildEngine(store, a);
                const paused = await engineA.execute('approval_flow');

                // Fresh engine (restart) resumes once.
                const b = { snapshot: undefined as unknown, ran: [] as string[] };
                const engineB = buildEngine(store, b);
                const first = await engineB.resume(paused.runId!, { branchLabel: 'approve' });
                expect(first.success).toBe(true);
                expect(b.ran.filter(x => x === 'approved')).toHaveLength(1);

                // A second resume of the same run finds nothing — no double-run.
                const second = await engineB.resume(paused.runId!, { branchLabel: 'approve' });
                expect(second.success).toBe(false);
                expect(second.error).toContain('No suspended run');
                expect(b.ran.filter(x => x === 'approved')).toHaveLength(1);
            });

            it('listSuspendedRunsDurable falls back to the in-memory list with no store', async () => {
                const e = new AutomationEngine(createTestLogger()); // no store
                e.registerNodeExecutor({
                    type: 'pause_node',
                    async execute() { return { success: true, suspend: true, correlation: 'req_1' }; },
                });
                e.registerFlow('p', {
                    name: 'p', label: 'P', type: 'autolaunched',
                    nodes: [
                        { id: 'start', type: 'start', label: 'Start' },
                        { id: 'pause', type: 'pause_node', label: 'Pause' },
                        { id: 'end', type: 'end', label: 'End' },
                    ],
                    edges: [
                        { id: 'e1', source: 'start', target: 'pause' },
                        { id: 'e2', source: 'pause', target: 'end' },
                    ],
                });
                const paused = await e.execute('p');
                const durable = await e.listSuspendedRunsDurable();
                expect(durable).toHaveLength(1);
                expect(durable[0].runId).toBe(paused.runId);
            });
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
        expect(nodeTypes).toContain('http');

        // connector_action is the generic-dispatch sibling of http and is
        // baseline (ADR-0018 §Addendum): the engine ships the node + an empty
        // connector registry; concrete connectors are plugins.
        expect(nodeTypes).toContain('connector_action');

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

    it('should register the http node type', () => {
        const types = engine.getRegisteredNodeTypes();
        expect(types).toContain('http');
    });

    it('should register connector_action in the built-in baseline', () => {
        // connector_action is baseline (ADR-0018 §Addendum): the engine ships the
        // generic-dispatch node + an empty connector registry; concrete connectors
        // are contributed by plugins via engine.registerConnector().
        expect(engine.getRegisteredNodeTypes()).toContain('connector_action');
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

// ─── Back-edge Re-entry Tests (ADR-0044) ─────────────────────────────

describe('AutomationEngine - Back-edge re-entry (ADR-0044)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    /** A self-looping counter flow: `inc` re-enters itself over a declared back-edge until the cap. */
    const counterFlow = (cap: number) => ({
        name: 'counter_flow',
        label: 'Counter Flow',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'inc', type: 'inc', label: 'Increment' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'inc' },
            { id: 'e_back', source: 'inc', target: 'inc', type: 'back', condition: `inc.count < ${cap}` },
            { id: 'e_done', source: 'inc', target: 'end', condition: `inc.count >= ${cap}` },
        ],
    });

    const registerIncExecutor = () => {
        let count = 0;
        engine.registerNodeExecutor({
            type: 'inc',
            async execute() {
                count += 1;
                return { success: true, output: { count } };
            },
        });
        return () => count;
    };

    it('accepts a cycle whose closing edge is typed back', () => {
        registerIncExecutor();
        expect(() => engine.registerFlow('counter_flow', counterFlow(3))).not.toThrow();
    });

    it('still rejects an unmarked cycle alongside a declared back-edge', () => {
        expect(() => engine.registerFlow('mixed_cycles', {
            name: 'mixed_cycles',
            label: 'Mixed Cycles',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'a', type: 'assignment', label: 'A' },
                { id: 'b', type: 'assignment', label: 'B' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'a' },
                { id: 'e2', source: 'a', target: 'b' },
                // declared rework loop — fine on its own…
                { id: 'e3', source: 'b', target: 'a', type: 'back' },
                // …but this second, unmarked cycle must still be rejected
                { id: 'e4', source: 'b', target: 'b' },
            ],
        })).toThrow(/cycle/i);
    });

    it('re-enters a node over the back-edge, overwriting its outputs (latest round wins)', async () => {
        const getCount = registerIncExecutor();
        engine.registerFlow('counter_flow', counterFlow(3));

        const result = await engine.execute('counter_flow', {});

        expect(result.success).toBe(true);
        expect(getCount()).toBe(3);
        // Every visit is its own step entry — observability shows each round.
        const run = (await engine.listRuns('counter_flow'))[0];
        expect(run.steps.filter(s => s.nodeId === 'inc')).toHaveLength(3);
    });

    it('aborts a runaway back-edge loop at the re-entry cap', async () => {
        registerIncExecutor();
        engine.registerFlow('counter_flow', counterFlow(1_000_000));

        const result = await engine.execute('counter_flow', {});

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/runaway/i);
        expect(result.error).toContain(String(AutomationEngine.MAX_NODE_REENTRIES));
    });

    it('cancelRun consumes a suspended run and records a terminal cancelled log', async () => {
        engine.registerNodeExecutor({
            type: 'pause',
            async execute() { return { success: true, suspend: true, correlation: 'test-pause' }; },
        });
        engine.registerFlow('pausing_flow', {
            name: 'pausing_flow',
            label: 'Pausing Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'hold', type: 'pause', label: 'Hold' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'end' },
            ],
        });

        const paused = await engine.execute('pausing_flow', {});
        expect(paused.status).toBe('paused');
        const runId = paused.runId!;

        expect(await engine.cancelRun(runId, 'abandoned by submitter')).toBe(true);
        expect(engine.listSuspendedRuns()).toHaveLength(0);
        // listRuns returns newest-first; the paused entry precedes the cancelled one.
        const log = (await engine.listRuns('pausing_flow'))[0];
        expect(log?.status).toBe('cancelled');
        expect(log?.error).toBe('abandoned by submitter');

        // The continuation is consumed: resume now fails, and cancel is idempotent.
        const resumed = await engine.resume(runId);
        expect(resumed.success).toBe(false);
        expect(await engine.cancelRun(runId)).toBe(false);
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

    it('evaluates CEL record-change conditions with bare fields and previous.* snapshot', () => {
        // The record-change trigger shape: the new record's fields are seeded at
        // top level, plus a `previous` snapshot. Regression guard — a broken
        // ExpressionEngine binding (e.g. an ESM `require` stub) made the CEL path
        // throw and silently return false, skipping every record-change flow.
        const vars = new Map<string, unknown>();
        vars.set('status', 'done');
        vars.set('assignee', 'newowner@example.com');
        vars.set('previous', { status: 'in_review', assignee: 'ada@example.com' });

        expect(engine.evaluateCondition({ dialect: 'cel', source: 'status == "done" && previous.status != "done"' }, vars)).toBe(true);
        expect(engine.evaluateCondition({ dialect: 'cel', source: 'assignee != previous.assignee' }, vars)).toBe(true);

        const unchanged = new Map<string, unknown>();
        unchanged.set('status', 'done');
        unchanged.set('previous', { status: 'done' });
        expect(engine.evaluateCondition({ dialect: 'cel', source: 'status == "done" && previous.status != "done"' }, unchanged)).toBe(false);
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
        expect(byType.get('http')?.category).toBe('io');

        // All built-ins are tagged source: 'builtin'.
        expect(byType.get('decision')?.source).toBe('builtin');
        expect(byType.get('http')?.source).toBe('builtin');
    });
});

// ─── Flow Trigger Wiring (record-change baseline mechanism) ──────────

import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

/**
 * A recording fake trigger: captures bindings/callbacks handed to it by the
 * engine, and lets a test fire the callback to simulate an event source.
 */
function recordingTrigger(type: string) {
    const started: FlowTriggerBinding[] = [];
    const stopped: string[] = [];
    const callbacks = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type,
        start(binding, callback) {
            started.push(binding);
            callbacks.set(binding.flowName, callback);
        },
        stop(flowName) {
            stopped.push(flowName);
            callbacks.delete(flowName);
        },
    };
    return { trigger, started, stopped, fire: (flow: string, ctx: AutomationContext) => callbacks.get(flow)!(ctx) };
}

function recordChangeFlow(name: string, overrides?: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched' as const,
        nodes: [
            {
                id: 'start',
                type: 'start' as const,
                label: 'On Update',
                config: {
                    objectName: 'task',
                    triggerType: 'record-after-update',
                    ...overrides,
                },
            },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

describe('AutomationEngine - Flow Trigger Wiring', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('binds a record-change flow to a matching trigger with a parsed binding', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_flow', recordChangeFlow('rc_flow', { condition: 'status == "done"' }));

        expect(engine.getActiveTriggerBindings()).toEqual([
            { flowName: 'rc_flow', triggerType: 'record_change' },
        ]);
        expect(rec.started).toHaveLength(1);
        expect(rec.started[0]).toMatchObject({
            flowName: 'rc_flow',
            object: 'task',
            event: 'record-after-update',
            condition: 'status == "done"',
        });
    });

    it('binds flows registered BEFORE the trigger (ordering-independent)', () => {
        // AutomationServicePlugin pulls flows at start(); a trigger plugin wires
        // up later on kernel:ready. Registering the trigger must retro-bind.
        engine.registerFlow('rc_flow', recordChangeFlow('rc_flow'));
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);

        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        expect(engine.getActiveTriggerBindings()).toEqual([
            { flowName: 'rc_flow', triggerType: 'record_change' },
        ]);
        expect(rec.started[0]?.flowName).toBe('rc_flow');
    });

    it('does not bind flows without an auto-trigger start config', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('manual_flow', {
            name: 'manual_flow',
            label: 'Manual',
            type: 'autolaunched' as const,
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);
        expect(rec.started).toHaveLength(0);
    });

    it('stops the binding when the flow is unregistered', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_flow', recordChangeFlow('rc_flow'));
        engine.unregisterFlow('rc_flow');

        expect(rec.stopped).toEqual(['rc_flow']);
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);
    });

    it('stops/restarts the binding when the flow is disabled/re-enabled', async () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_flow', recordChangeFlow('rc_flow'));

        await engine.toggleFlow('rc_flow', false);
        expect(rec.stopped).toEqual(['rc_flow']);
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);

        await engine.toggleFlow('rc_flow', true);
        expect(engine.getActiveTriggerBindings()).toHaveLength(1);
        expect(rec.started).toHaveLength(2);
    });

    it('unregistering the trigger stops all its bound flows', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_flow', recordChangeFlow('rc_flow'));
        engine.unregisterTrigger('record_change');

        expect(rec.stopped).toEqual(['rc_flow']);
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);
    });

    it('firing the trigger callback runs the flow with the record context', async () => {
        const rec = recordingTrigger('record_change');
        const seen: Array<{ status?: unknown; prevStatus?: unknown }> = [];
        engine.registerNodeExecutor({
            type: 'probe',
            async execute(_node, variables) {
                seen.push({ status: variables.get('status'), prevStatus: (variables.get('previous') as any)?.status });
                return { success: true };
            },
        });
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_flow', {
            ...recordChangeFlow('rc_flow'),
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
                { id: 'probe', type: 'probe' as const, label: 'Probe' },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'probe' },
                { id: 'e2', source: 'probe', target: 'end' },
            ],
        });

        await rec.fire('rc_flow', { record: { status: 'done' }, previous: { status: 'open' }, object: 'task', event: 'record-after-update' });
        expect(seen).toEqual([{ status: 'done', prevStatus: 'open' }]);
    });
});

describe('AutomationEngine - flow status enable/disable gate', () => {
    let engine: AutomationEngine;
    beforeEach(() => { engine = new AutomationEngine(createTestLogger()); });

    it('binds + enables draft/active flows — existing flows are unaffected', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_draft', recordChangeFlow('rc_draft')); // status defaults to 'draft'
        engine.registerFlow('rc_active', { ...recordChangeFlow('rc_active'), status: 'active' });
        const states = engine.getFlowRuntimeStates();
        expect(states.find((s) => s.name === 'rc_draft')).toMatchObject({ name: 'rc_draft', enabled: true, bound: true, status: 'draft' });
        expect(states.find((s) => s.name === 'rc_active')).toMatchObject({ name: 'rc_active', enabled: true, bound: true, status: 'active' });
        expect(engine.getActiveTriggerBindings()).toHaveLength(2);
    });

    it('does NOT bind or enable a flow whose status is obsolete', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('rc_obsolete', { ...recordChangeFlow('rc_obsolete'), status: 'obsolete' });
        expect(engine.getActiveTriggerBindings()).toHaveLength(0);
        expect(engine.getFlowRuntimeStates().find((s) => s.name === 'rc_obsolete'))
            .toMatchObject({ name: 'rc_obsolete', enabled: false, bound: false, status: 'obsolete' });
    });

    it('refuses to execute a disabled (obsolete) flow', async () => {
        engine.registerFlow('x', { ...recordChangeFlow('x'), status: 'obsolete' });
        const res = await engine.execute('x', { event: 'test' } as never);
        expect(res.success).toBe(false);
        expect(res.error).toContain('disabled');
    });

    it('flipping status obsolete → active re-enables + re-binds on re-register', () => {
        const rec = recordingTrigger('record_change');
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('flip', { ...recordChangeFlow('flip'), status: 'obsolete' });
        expect(engine.getFlowRuntimeStates().find((s) => s.name === 'flip')).toMatchObject({ enabled: false, bound: false });
        // Re-author to active and re-register (what a publish rebind does).
        engine.registerFlow('flip', { ...recordChangeFlow('flip'), status: 'active' });
        expect(engine.getFlowRuntimeStates().find((s) => s.name === 'flip')).toMatchObject({ enabled: true, bound: true });
    });
});

describe('AutomationEngine - Start Condition Gate', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    function gatedFlow() {
        return {
            name: 'gated',
            label: 'Gated',
            type: 'autolaunched' as const,
            nodes: [
                {
                    id: 'start',
                    type: 'start' as const,
                    label: 'Start',
                    config: { objectName: 'task', triggerType: 'record-after-update', condition: 'status == "done" && previous.status != "done"' },
                },
                { id: 'probe', type: 'probe' as const, label: 'Probe' },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'probe' },
                { id: 'e2', source: 'probe', target: 'end' },
            ],
        };
    }

    let ran: number;
    beforeEach(() => {
        ran = 0;
        engine.registerNodeExecutor({
            type: 'probe',
            async execute() {
                ran++;
                return { success: true };
            },
        });
        engine.registerFlow('gated', gatedFlow());
    });

    it('runs the flow when the start condition is met (transition into done)', async () => {
        const result = await engine.execute('gated', { record: { status: 'done' }, previous: { status: 'open' } });
        expect(result.success).toBe(true);
        expect((result.output as any)?.skipped).toBeUndefined();
        expect(ran).toBe(1);
    });

    it('skips the flow when the start condition is not met (already done)', async () => {
        const result = await engine.execute('gated', { record: { status: 'done' }, previous: { status: 'done' } });
        expect(result.success).toBe(true);
        expect((result.output as any)?.skipped).toBe(true);
        expect(ran).toBe(0);
    });
});
