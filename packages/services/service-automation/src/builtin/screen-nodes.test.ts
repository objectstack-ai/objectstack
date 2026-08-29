// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptConfigSchema } from '@objectstack/spec/automation';
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

    it('FAILS LOUDLY for an unregistered function instead of silently no-op (#1870)', async () => {
        // No resolver wired → nothing resolves.
        engine.registerFlow('script_flow', scriptFlow({ function: 'helpdesk.aiTriageStub' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/aiTriageStub/);
        expect(result.error).toMatch(/no function named/i);
        // It stays a ROUTABLE failure, not a guard: the function registry is the
        // host's, so the same metadata succeeds where the name is registered
        // (#3863). config-parse.test.ts pins that with a fault edge.
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
        engine.registerFlow('script_flow', scriptFlow({ functionName: 'helpdesk.aiTriageStub', inputs: { ticketId: 't1' } }));
        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(calledWith).toEqual({ ticketId: 't1' });
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
 * #4343 — what a STORED flow carrying a retired dispatch branch does now.
 *
 * The retirement has two channels and they reach different people. The
 * `retiredKey()` tombstones teach whoever *authors* the key: `tsc` types it
 * `never`, and a direct `ScriptConfigSchema` parse raises the prescription.
 * They never reach a stored flow — `FlowNodeSchema.config` is
 * `z.record(z.unknown())`, so no load-path parse descends into a node's config.
 *
 * A stored flow meets the other channel. `registerFlow` canonicalizes data at
 * rest through the RETIRED conversion too (#3903 — a row in `sys_metadata` has
 * no author for a tombstone to teach), so the doomed keys are stripped on
 * rehydration with a logged notice, and the execute-time parse then judges
 * what is left. For the branches that never delivered anything, what is left
 * names no callable — so the node refuses, loudly, where it used to log a line
 * and report success. That flip is the whole point of the retirement, and it is
 * what these cases pin.
 */
describe('script retired branches, as a stored flow meets them (#4343)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());
        engine.setFunctionResolver((name) => (name === 'score_lead' ? (() => 1) : undefined));
    });

    it.each([
        ['the email stub', { actionType: 'email', template: 't', recipients: ['a'], variables: { x: 1 } }],
        ['the slack stub', { actionType: 'slack', template: 't', recipients: ['#tasks'] }],
        ['the example shape, payload in `inputs`', { actionType: 'email', inputs: { to: 'a@b.c' } }],
        ['an inline body', { script: 'return { ok: true };' }],
        ['the bare marker', { actionType: 'invoke_function' }],
    ] as const)('%s no longer succeeds silently — it refuses, naming the callable it lacks', async (_name, config) => {
        engine.registerFlow('script_flow', scriptFlow({ ...config }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toContain('does not satisfy the script contract');
        expect(result.error).toContain('config.function');
    });

    it('converts a shorthand `actionType` into the function it always named, and runs it', async () => {
        // The one retired value carrying real intent: `actionType` that matched
        // no built-in was a function name (#1870), so the conversion moves it
        // rather than dropping it — and the node keeps working.
        engine.registerFlow('script_flow', scriptFlow({ actionType: 'score_lead' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(true);
    });

    it('accepts the converged shape', async () => {
        engine.registerFlow('script_flow', scriptFlow({ function: 'score_lead' }));
        const result = await engine.execute('script_flow', {} as any);
        expect(result.success).toBe(true);
    });

    it('the tombstones still refuse an AUTHORED key outright, prescription and all', () => {
        // The other channel: no conversion runs in front of a direct parse, so
        // this is what `tsc` and `os validate` put in front of an author.
        const result = ScriptConfigSchema.safeParse({ function: 'score_lead', actionType: 'email' });
        expect(result.success).toBe(false);
        expect(result.error!.issues[0]!.message).toMatch(/`script\.config\.actionType` was removed/);
        expect(result.error!.issues[0]!.message, 'the prescription teaches the replacement, never a tracker id')
            .not.toMatch(/#\d{3,5}/);
        expect(ScriptConfigSchema.parse({
            function: 'score_lead',
            inputs: { leadId: '{record.id}' },
            outputVariable: 'score',
        })).toMatchObject({ function: 'score_lead' });
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

/**
 * #4396 — a `script` function is contractually pure, and the run summary counts
 * on it: the node reports NO record metrics because every write a pure function
 * causes is a downstream declarative node counting itself. A function that
 * legitimately writes DECLARES it, and only then does its step report an effect
 * the platform cannot count.
 */
describe('script node — the purity contract and its declared exception (#4396)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());
    });

    it("publishes the contract on the action descriptor, where an author can read it", () => {
        const script = engine.getActionDescriptors().find((d) => d.type === 'script');
        expect(script?.handlerContract).toBe('pure');
    });

    it('reports NO metrics for a pure function — absent is the accurate answer, not a guess', async () => {
        engine.setFunctionResolver(() => () => ({ ai_category: 'billing' }));
        engine.registerFlow('script_flow', scriptFlow({ function: 'triage', outputVariable: 'ai' }));

        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(r.summary?.unmeasured).toBe(0);
        const node = r.summary?.nodes.find((n) => n.nodeId === 'run');
        expect(node).toMatchObject({ runs: 1, status: 'success' });
        expect(node?.selected).toBeUndefined();
        expect(node?.acted).toBeUndefined();
    });

    it("counts a declared writer's step as an effect it cannot measure", async () => {
        // The under-report this closes: without the declaration the run below
        // says `acted: 0` — indistinguishable from a sweep that did nothing.
        engine.setFunctionResolver((name) =>
            name === 'syncBilling' ? { handler: () => ({ ok: true }), effect: 'writes' } : undefined);
        engine.registerFlow('script_flow', scriptFlow({ function: 'syncBilling' }));

        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(r.summary?.acted).toBe(0);
        // ...but NOT "measured as zero": the third answer keeps the
        // broken-sweep query (`acted = 0 AND unmeasured = 0`) off this run.
        expect(r.summary?.unmeasured).toBe(1);
        expect(r.summary?.nodes.find((n) => n.nodeId === 'run')?.unmeasured).toBe(1);
    });

    it('still reports the effect when a declared writer throws — it may have written first', async () => {
        engine.setFunctionResolver(() => ({
            handler: () => { throw new Error('upstream 500'); },
            effect: 'writes',
        }));
        engine.registerFlow('script_flow', scriptFlow({ function: 'syncBilling' }));

        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(false);
        expect(r.summary?.unmeasured).toBe(1);
    });

    it('leaves every OTHER flow measurable — declaring is per function, not per node type', async () => {
        // The rejected fix was a blanket `unmeasuredEffect` on every script
        // step, which would have blinded the detector on every flow that calls
        // any function. A pure call in the same run must still count as
        // measured.
        engine.setFunctionResolver((name) =>
            name === 'syncBilling'
                ? { handler: () => ({ ok: true }), effect: 'writes' }
                : () => ({ score: 1 }));
        engine.registerFlow('mixed', {
            name: 'mixed', label: 'Mixed', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'pure', type: 'script', label: 'Pure', config: { function: 'scoreLead' } },
                { id: 'writer', type: 'script', label: 'Writer', config: { function: 'syncBilling' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'pure' },
                { id: 'e2', source: 'pure', target: 'writer' },
                { id: 'e3', source: 'writer', target: 'end' },
            ],
        } as any);

        const r = await engine.execute('mixed', {} as any);
        expect(r.success).toBe(true);
        expect(r.summary?.unmeasured).toBe(1);
        expect(r.summary?.nodes.find((n) => n.nodeId === 'pure')?.unmeasured).toBeUndefined();
        expect(r.summary?.nodes.find((n) => n.nodeId === 'writer')?.unmeasured).toBe(1);
    });

    it('reads a bare handler as the pure default — the short spelling of the contract', async () => {
        const calls: unknown[] = [];
        engine.setFunctionResolver(() => (c: any) => { calls.push(c.input); return 1; });
        engine.registerFlow('script_flow', scriptFlow({ function: 'scoreLead', inputs: { r: 'x' } }));

        const r = await engine.execute('script_flow', {} as any);
        expect(r.success).toBe(true);
        expect(calls).toEqual([{ r: 'x' }]);
        expect(r.summary?.unmeasured).toBe(0);
    });
});

/**
 * The one part of the purity contract the runtime CAN hold: a flow function is
 * handed nothing to write with. Not enforcement — a function may close over a
 * client at module scope — but the day someone adds `ctx.api` here, the
 * contract stops being about author discipline and starts being a lie, so the
 * context's shape is pinned rather than left incidental (#4396, issue option 3).
 */
describe('FlowFunctionContext carries no data reach (#4396)', () => {
    it('hands the function input / variables / automation / logger and nothing else', async () => {
        const engine = new AutomationEngine(createTestLogger());
        registerScreenNodes(engine, createCtx());

        let seen: Record<string, unknown> | undefined;
        engine.setFunctionResolver(() => (c: any) => { seen = c; return 1; });
        engine.registerFlow('script_flow', scriptFlow({ function: 'inspect' }));
        await engine.execute('script_flow', {} as any);

        expect(Object.keys(seen ?? {}).sort()).toEqual(['automation', 'input', 'logger', 'variables']);
        // `automation` is the trigger/run context (record, identity, params) —
        // provenance, not a handle on the data engine.
        expect(seen!.automation).not.toHaveProperty('api');
        expect(seen!.automation).not.toHaveProperty('objectql');
    });
});
