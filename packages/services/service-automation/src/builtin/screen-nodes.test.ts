// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, type FlowFunctionHandler } from '../engine.js';
import { registerScreenNodes } from './screen-nodes.js';

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

/** A one-`script`-node flow whose script node carries `config`. */
function scriptFlow(config: Record<string, unknown>) {
    return {
        name: 'script_flow',
        label: 'Script Flow',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'run', type: 'script' as const, label: 'Run', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'run' },
            { id: 'e2', source: 'run', target: 'end' },
        ],
    };
}

describe('script node (#1870 — callable resolution)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());
    });

    it('runs the built-in email side-effect', async () => {
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'email', template: 't', recipients: ['a'] }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(true);
    });

    it('invokes a registered function and captures its return value as output', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const fn: FlowFunctionHandler = (c) => {
            calls.push(c.input);
            return { triaged: true, priority: 'high' };
        };
        engine.setFunctionResolver((name) => (name === 'helpdesk.aiTriageStub' ? fn : undefined));

        engine.registerFlow('script_flow', scriptFlow({
            function: 'helpdesk.aiTriageStub',
            inputs: { ticket: 't_1' },
        }));
        const result = await engine.execute('script_flow', {} as any);

        expect(result.success).toBe(true);
        expect(calls).toEqual([{ ticket: 't_1' }]);
    });

    it('resolves a bare actionType that matches no built-in as a function name', async () => {
        let called = false;
        engine.setFunctionResolver((name) => (name === 'pm.aiRiskAssessmentStub' ? (() => { called = true; return 1; }) : undefined));
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'pm.aiRiskAssessmentStub' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(true);
        expect(called).toBe(true);
    });

    it('FAILS LOUDLY for an unregistered function instead of silently no-op (#1870)', async () => {
        // No resolver wired → nothing resolves.
        engine.registerFlow('script_flow', scriptFlow({ function: 'helpdesk.aiTriageStub' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/aiTriageStub/);
        expect(result.error).toMatch(/no function named|not a built-in/i);
    });

    it('recognizes inline config.script as a no-op (not a loud failure) — built-in runtime has no JS sandbox', async () => {
        engine.registerFlow('script_flow', scriptFlow({ script: 'variables.x = 1;', outputVariables: ['x'] }));
        const result = await engine.execute('script_flow', {} as any);
        // Recognized form: succeeds (doesn't fail loud), but is documented as not executed.
        expect(result.success).toBe(true);
    });

    it('FAILS LOUDLY when the script node declares no target at all (actionType: undefined repro)', async () => {
        engine.registerFlow('script_flow', scriptFlow({ actionType: undefined }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/neither .*actionType.* nor .*function|nothing to run/i);
    });

    it('surfaces a thrown function as a loud step failure', async () => {
        engine.setFunctionResolver(() => () => { throw new Error('boom'); });
        engine.registerFlow('script_flow', scriptFlow({ function: 'explode' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/explode.*failed|failed.*boom|boom/i);
    });
it('resolves config.functionName as an alias for function (#1870 DX)', async () => {
        let calledWith: any;
        engine.setFunctionResolver((name) =>
            name === 'helpdesk.aiTriageStub' ? ((c: any) => { calledWith = c.input; return { triaged: true }; }) : undefined);
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'invoke_function', functionName: 'helpdesk.aiTriageStub', inputs: { ticketId: 't1' } }));
        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(calledWith).toEqual({ ticketId: 't1' });
    });

    it('treats actionType invoke_function as a marker, not a function name', async () => {
        // invoke_function alone (no function/functionName) must NOT try to resolve a
        // function literally named 'invoke_function'; it fails with a clear message.
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'invoke_function' }));
        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/invoke_function.*requires.*function/i);
    });
    it('exposes the function result via outputVariable for downstream nodes (pure-function pattern)', async () => {
        const seen: Array<Record<string, unknown>> = [];
        engine.setFunctionResolver((name) => {
            if (name === 'compute') return () => ({ ai_category: 'billing', ai_confidence: 0.9 });
            if (name === 'consume') return ((c: any) => { seen.push(c.input); return null; });
            return undefined;
        });
        engine.registerFlow('chain', {
            name: 'chain', label: 'Chain', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'mk', type: 'script', label: 'compute', config: { function: 'compute', outputVariable: 'aiResult' } },
                { id: 'use', type: 'script', label: 'consume', config: { function: 'consume', inputs: { cat: '{aiResult.ai_category}', conf: '{aiResult.ai_confidence}' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mk' },
                { id: 'e2', source: 'mk', target: 'use' },
                { id: 'e3', source: 'use', target: 'end' },
            ],
        } as any);
        const r = await engine.execute('chain', {} as any);
        expect(r.success).toBe(true);
        expect(seen).toEqual([{ cat: 'billing', conf: 0.9 }]);
    });
});
