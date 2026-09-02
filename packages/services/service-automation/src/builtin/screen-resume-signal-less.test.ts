// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A signal-less `resume(runId)` is held to the suspended screen's declared
 * field contract exactly like a signal-carrying one (#13648).
 *
 * `refuseInvalidScreenInput` (#4477) used to open with `if (!signal) return
 * null;` — so `resume(runId, { variables: {} })` was refused with
 * `INVALID_SCREEN_INPUT` while `resume(runId)` completed the run with every
 * unconditional `required` field unbound. The engine already had a NAMED
 * exemption for the one legitimate case — its own continuations, tagged
 * `ENGINE_BUILT_SIGNAL` — and the bare early return was a second, unnamed
 * spelling of an exemption nobody had asked for. Ruling (triage, 2026-08-31):
 * the governed side wins — the early return is gone, an absent signal is an
 * empty submission, and the engine-built flag is the only exemption left.
 *
 * The HTTP door (`POST …/runs/:runId/resume`) never reached the hole — it
 * assembles `{}` for an empty body — so these pins sit on the in-process door
 * `AutomationEngine.resume`, which is also what the wait node's timer wake
 * calls with no signal (and must keep doing: a `wait` pause declares no
 * screen contract, so an empty submission against it is conformant;
 * `wait-node.test.ts` owns that half).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** A one-screen flow whose screen declares exactly `fields`. */
function screenFlow(name: string, fields: Array<Record<string, unknown>>, screenConfig: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'screen',
        status: 'active',
        version: 1,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'ask', type: 'screen', label: 'Ask', config: { ...screenConfig, ...(fields.length ? { fields } : {}) } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'ask', type: 'default' },
            { id: 'e2', source: 'ask', target: 'end', type: 'default' },
        ],
    };
}

const REQUIRED_KIND = [{ name: 'kind', label: 'Kind', type: 'text', required: true }];

describe('signal-less resume of a screen with a required field (#13648)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('triage', screenFlow('triage', REQUIRED_KIND) as any);
    });

    async function pause(): Promise<string> {
        const started = await engine.execute('triage', {} as any);
        expect(started.status).toBe('paused');
        expect(started.screen?.nodeId).toBe('ask');
        return started.runId!;
    }

    it('refuses `resume(runId)` with INVALID_SCREEN_INPUT and leaves the run paused', async () => {
        const runId = await pause();

        const res = await engine.resume(runId);

        // The ADR-0112 envelope, not a bare "it failed": the same code and the
        // same first sentence the signal-carrying refusal answers.
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.error).toMatch(/^Invalid screen input: /);
        expect(res.error).toContain('"kind"');
        expect(res.error).toMatch(/required/i);
        // The pause was NOT consumed — the run is exactly where it was.
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
        expect((await engine.getSuspendedScreen(runId))?.nodeId).toBe('ask');
    });

    it('answers the signal-less and the empty-bag resume with the SAME envelope', async () => {
        const runId = await pause();
        const bare = await engine.resume(runId);
        const empty = await engine.resume(runId, { variables: {} });
        expect(bare).toEqual(empty);
    });

    it('resumes the same run once the field is supplied', async () => {
        const runId = await pause();
        expect((await engine.resume(runId)).code).toBe('INVALID_SCREEN_INPUT');

        const good = await engine.resume(runId, { variables: { kind: 'normal' } });

        expect(good.success).toBe(true);
        expect(good.code).toBeUndefined();
        expect(good.status).toBeUndefined(); // ran to completion
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
    });
});

describe('signal-less resume of a pause that declares no contract proceeds (#13648)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
    });

    async function pauseOn(flow: Record<string, unknown>): Promise<string> {
        engine.registerFlow(flow.name as string, flow as any);
        const started = await engine.execute(flow.name as string, {} as any);
        expect(started.status).toBe('paused');
        return started.runId!;
    }

    it('a screen whose fields are all optional', async () => {
        const runId = await pauseOn(screenFlow('optional_only', [
            { name: 'note', label: 'Note', type: 'text' },
            { name: 'flag', label: 'Flag', type: 'boolean', required: false },
        ]));
        const res = await engine.resume(runId);
        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
    });

    it('a MESSAGE-ONLY screen — no keys declared, none constrained', async () => {
        const runId = await pauseOn(screenFlow('message_only', [], { title: 'Confirm', waitForInput: true }));
        const res = await engine.resume(runId);
        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
    });

    it('an OBJECT-FORM screen — the record write path enforces its own required fields', async () => {
        const runId = await pauseOn(screenFlow('object_form', [], {
            objectName: 'crm_account', mode: 'create', idVariable: 'account_id',
        }));
        expect((await engine.getSuspendedScreen(runId))?.kind).toBe('object-form');
        const res = await engine.resume(runId);
        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
    });

    it('a required field the screen HIDES (`visibleWhen` false) — the visibility layer applies to an empty bag too', async () => {
        const runId = await pauseOn(screenFlow('hidden_required', [
            { name: 'reason', label: 'Reason', type: 'text', required: true, visibleWhen: 'false' },
        ]));
        const res = await engine.resume(runId);
        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
    });
});

describe("engine-built continuation stays exempt — the flag is the ONLY exemption (#13648 negative control)", () => {
    let engine: AutomationEngine;
    let captured: unknown[];

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        captured = [];
        // Copies the screen-collected `kind` into the child's declared output.
        engine.registerNodeExecutor({
            type: 'copier',
            async execute(_node, variables) {
                variables.set('result', variables.get('kind'));
                return { success: true };
            },
        } as NodeExecutor);
        // Parent step after the subflow: captures the mapped output variable.
        engine.registerNodeExecutor({
            type: 'parentcheck',
            async execute(_node, variables) {
                captured.push(variables.get('subResult'));
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow('child', {
            name: 'child',
            label: 'Child',
            type: 'autolaunched',
            variables: [{ name: 'result', type: 'text', isOutput: true }],
            nodes: [
                { id: 's', type: 'start', label: 'Start' },
                { id: 'ask', type: 'screen', label: 'Ask', config: { fields: REQUIRED_KIND } },
                { id: 'copy', type: 'copier', label: 'Copy' },
                { id: 'e', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'c1', source: 's', target: 'ask' },
                { id: 'c2', source: 'ask', target: 'copy' },
                { id: 'c3', source: 'copy', target: 'e' },
            ],
        } as any);
        engine.registerFlow('parent', {
            name: 'parent',
            label: 'Parent',
            type: 'autolaunched',
            nodes: [
                { id: 'ps', type: 'start', label: 'Start' },
                { id: 'call', type: 'subflow', label: 'Call Child', config: { flowName: 'child', outputVariable: 'subResult' } },
                { id: 'chk', type: 'parentcheck', label: 'Check' },
                { id: 'pe', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'p1', source: 'ps', target: 'call' },
                { id: 'p2', source: 'call', target: 'chk' },
                { id: 'p3', source: 'chk', target: 'pe' },
            ],
        } as any);
    });

    it("a child's completion bubbles up through an engine-built signal whose bag lacks the parent's surfaced required field", async () => {
        const started = await engine.execute('parent', {} as any);
        expect(started.status).toBe('paused');
        const parentRunId = started.runId!;
        // The parent surfaces the CHILD's screen — required `kind` included —
        // so the up-bubble below is judged against a screen with a required
        // field, and only the engine-built flag lets it through.
        expect((await engine.getSuspendedScreen(parentRunId))?.fields?.map((f) => f.name)).toEqual(['kind']);
        const child = engine.listSuspendedRuns().find((r) => r.flowName === 'child')!;
        expect(child).toBeDefined();

        // Resume the CHILD directly (the approval/wait-style path) with the
        // field it asked for; its completion resumes the parent with the
        // engine's own output-mapping signal, which never carries `kind`.
        const childRes = await engine.resume(child.runId, { variables: { kind: 'escalate' } });

        expect(childRes.success).toBe(true);
        expect(childRes.status).toBeUndefined();
        expect(captured).toEqual([{ result: 'escalate' }]);
        expect(engine.listSuspendedRuns()).toHaveLength(0);
    });

    it("a signal-less resume of the CHILD is still refused — the flag exempts the engine's signal, not the run", async () => {
        const started = await engine.execute('parent', {} as any);
        const child = engine.listSuspendedRuns().find((r) => r.flowName === 'child')!;

        const res = await engine.resume(child.runId);

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(await engine.hasSuspendedRun(child.runId)).toBe(true);
        expect(await engine.hasSuspendedRun(started.runId!)).toBe(true);
        expect(captured).toEqual([]);
    });
});
