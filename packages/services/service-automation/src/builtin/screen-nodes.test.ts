// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    SCRIPT_BUILTIN_ACTION_TYPES,
    SCRIPT_INVOKE_FUNCTION_ACTION_TYPE,
    ScriptConfigSchema,
} from '@objectstack/spec/automation';
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
it('canonicalizes a stored `functionName` key to `function` at load (#1870 DX, #3796)', async () => {
        // `registerFlow` runs the ADR-0087 D2 conversion
        // 'flow-node-script-config-aliases', so the deprecated alias keeps
        // working for stored flows while the executor reads `function` only.
        let calledWith: any;
        engine.setFunctionResolver((name) =>
            name === 'helpdesk.aiTriageStub' ? ((c: any) => { calledWith = c.input; return { triaged: true }; }) : undefined);
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'invoke_function', functionName: 'helpdesk.aiTriageStub', inputs: { ticketId: 't1' } }));
        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(calledWith).toEqual({ ticketId: 't1' });
    });

    it('treats actionType invoke_function as a marker, not a function name', async () => {
        // invoke_function alone (no `function`) must NOT try to resolve a
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

/**
 * #4278 — the script node's contract is the spec-published one. The designer
 * form for `script` is objectui's hand-written group (this node deliberately
 * publishes no descriptor configSchema — config-schemas.test.ts), so the only
 * machine-readable statement of what it accepts is
 * `SCRIPT_BUILTIN_ACTION_TYPES` / `ScriptConfigSchema` in
 * `@objectstack/spec/automation`. These pins are the objectstack half of the
 * cross-repo reconciliation: the executor dispatches exactly the published
 * built-in set (it now builds its dispatch set FROM the constant), and its
 * failure message names that same set — objectui's side reconciles its form
 * options and key set against the same exports.
 */
describe('script contract ↔ spec-published constants (#4278)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());
    });

    it.each([...SCRIPT_BUILTIN_ACTION_TYPES])(
        "every published built-in actionType runs the built-in branch: '%s'",
        async (actionType) => {
            engine.registerFlow('script_flow', scriptFlow({ actionType, template: 't', recipients: ['a'] }));
            const result = await engine.execute('script_flow', {} as any);
            expect(result.success).toBe(true);
        },
    );

    it('an actionType outside the published set fails naming exactly that set (the #4278 sms repro)', async () => {
        // The old objectui form offered 'sms' / 'notification'; neither is in
        // the published set, so they resolve as function names and fail. The
        // error must name the published members — it is the message the #4278
        // report quoted, and the form's options now come from the same constant.
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'sms' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        for (const builtin of SCRIPT_BUILTIN_ACTION_TYPES) {
            expect(result.error).toContain(builtin);
        }
        expect(result.error).toMatch(/'sms' is not a built-in action/);
    });

    it('the published Zod accepts the canonical authoring shapes (contract sanity)', () => {
        // Function path — the only shape that does real work.
        expect(ScriptConfigSchema.parse({
            actionType: SCRIPT_INVOKE_FUNCTION_ACTION_TYPE,
            function: 'score_lead',
            inputs: { leadId: '{record.id}' },
            outputVariable: 'score',
        })).toMatchObject({ function: 'score_lead' });
        // Built-in side effect.
        expect(ScriptConfigSchema.parse({ actionType: 'email', template: 't', recipients: ['a'], variables: { x: 1 } }))
            .toMatchObject({ actionType: 'email' });
        // Inline script — recognized (and documented as not executed).
        expect(ScriptConfigSchema.parse({ script: 'return 1;' })).toMatchObject({ script: 'return 1;' });
    });
});

/** A one-`screen`-node flow whose screen node carries `config`. */
function screenFlow(config: Record<string, unknown>) {
    return {
        name: 'screen_flow',
        label: 'Screen Flow',
        type: 'screen' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'collect', type: 'screen' as const, label: 'Collect', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'collect' },
            { id: 'e2', source: 'collect', target: 'end' },
        ],
    };
}

describe('screen node — the field wire payload (#3528)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());
    });

    /**
     * `visibleWhen` has been on the screen node's designer form since #3304 but
     * was dropped when the executor built the paused payload, so it reached no
     * client and nothing honoured it. HotCRM's lead-conversion screen is the
     * shape that made it fatal: an optional-by-design field that is `required`
     * *when shown*. Rendered unconditionally, it blocks Submit on input the
     * user was never asked for, and the run never resumes.
     */
    it('forwards visibleWhen to the paused screen so the client can honour it', async () => {
        engine.registerFlow('screen_flow', screenFlow({
            title: 'Conversion Details',
            fields: [
                { name: 'createOpportunity', label: 'Create Opportunity?', type: 'boolean', required: true },
                { name: 'opportunityName', label: 'Opportunity Name', type: 'text', required: true, visibleWhen: 'createOpportunity == true' },
                { name: 'opportunityAmount', label: 'Opportunity Amount', type: 'currency', visibleWhen: 'createOpportunity == true' },
            ],
        }) as any);

        const paused = await engine.execute('screen_flow');
        expect(paused.status).toBe('paused');
        const fields = paused.screen!.fields;
        expect(fields.map((f) => f.visibleWhen)).toEqual([
            undefined,
            'createOpportunity == true',
            'createOpportunity == true',
        ]);
        // The conditional field keeps `required` — it is required *when shown*.
        // Honouring one without the other is what dead-ends the run.
        expect(fields[1]).toMatchObject({ name: 'opportunityName', required: true });
    });

    it('leaves visibleWhen undefined when the author declared none', async () => {
        engine.registerFlow('screen_flow', screenFlow({
            fields: [{ name: 'subject', label: 'Subject', type: 'text', required: true }],
        }) as any);

        const paused = await engine.execute('screen_flow');
        expect(paused.screen!.fields[0].visibleWhen).toBeUndefined();
    });

    /**
     * The predicate is re-evaluated by the client on every keystroke against
     * the values collected so far, which the server cannot see. Interpolating
     * it here would bake in a verdict from flow variables and freeze the field.
     */
    it('forwards the predicate RAW — it is not interpolated against flow variables', async () => {
        engine.registerFlow('screen_flow', screenFlow({
            fields: [
                { name: 'tier', label: 'Tier', type: 'text' },
                // `{recordId}` is a live flow variable; were the predicate
                // interpolated it would come back with the value substituted.
                { name: 'note', label: 'Note', type: 'text', visibleWhen: 'tier == "gold" && "{recordId}" != ""' },
            ],
        }) as any);

        const paused = await engine.execute('screen_flow', { params: { recordId: 'lead_1' } } as any);
        expect(paused.screen!.fields[1].visibleWhen).toBe('tier == "gold" && "{recordId}" != ""');
    });
});
