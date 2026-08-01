// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resume` enforces the suspended screen's declared field contract (#4477).
 *
 * The specimen is the issue's, verbatim: a two-field screen whose second field
 * is `required` and conditional on the first. The RENDER half already worked —
 * the paused result and `GET …/runs/:runId/screen` carry `required` and
 * `visibleWhen` intact. There was no validation half: `POST …/resume` folded
 * whatever bag it was handed straight into the flow variables, so all four
 * shapes below completed the run with `success: true`. A client that skipped
 * the dialog and posted to `resume` directly was unconstrained by every
 * `required` the author declared.
 *
 * Screen flows are the one place where the declared field contract is the ONLY
 * contract — no object schema sits behind a screen node to catch a bad bag
 * downstream, unlike action params (ADR-0104 D2), record writes (ADR-0113) and
 * approval `decisionOutputs` (#3447), all of which already enforce theirs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** The issue's specimen: `kind` unconditionally required, `escalation_reason`
 *  required only when `kind == 'escalate'`. */
function triageFlow() {
    return {
        name: 'triage',
        label: 'Triage',
        type: 'screen',
        status: 'active',
        version: 1,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'ask', type: 'screen', label: 'Triage',
                config: {
                    fields: [
                        { name: 'kind', label: 'Kind', type: 'text', required: true },
                        {
                            name: 'escalation_reason', label: 'Escalation reason', type: 'text',
                            required: true, visibleWhen: "kind == 'escalate'",
                        },
                    ],
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'ask', type: 'default' },
            { id: 'e2', source: 'ask', target: 'end', type: 'default' },
        ],
    };
}

describe('screen resume validation (#4477)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('triage', triageFlow() as any);
    });

    /** Run to the screen pause and return the run id. */
    async function pause(): Promise<string> {
        const started = await engine.execute('triage', {} as any);
        expect(started.status).toBe('paused');
        expect(started.screen?.nodeId).toBe('ask');
        return started.runId!;
    }

    it('still accepts the conforming submission — the conditional field stays hidden', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, { variables: { kind: 'normal' } });
        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
    });

    it('accepts the conditional field when its predicate is TRUE and the value is there', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, {
            variables: { kind: 'escalate', escalation_reason: 'customer churn risk' },
        });
        expect(res.success).toBe(true);
    });

    // ── The four rows of the issue's table ────────────────────────────────

    it('rejects a VISIBLE conditional field whose required value is missing', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, { variables: { kind: 'escalate' } });
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.error).toContain('escalation_reason');
        expect(res.error).toMatch(/required/i);
    });

    it('rejects a missing UNCONDITIONAL required field', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, { variables: {} });
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.error).toContain('kind');
    });

    it('rejects an UNDECLARED key', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, { variables: { kind: 'normal', totally_bogus: 'x' } });
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.error).toContain('totally_bogus');
        // The declared list rides along, so the caller can self-correct — the
        // same courtesy `decisionOutputs` extends (#3447).
        expect(res.error).toContain("'kind'");
        expect(res.error).toContain("'escalation_reason'");
    });

    it('treats an empty string / null as absent, not as a value', async () => {
        for (const value of ['', '   ', null]) {
            const runId = await pause();
            const res = await engine.resume(runId, { variables: { kind: value } });
            expect(res.success, `kind=${JSON.stringify(value)}`).toBe(false);
            expect(res.code).toBe('INVALID_SCREEN_INPUT');
        }
    });

    // ── The refusal must not consume the pause ────────────────────────────

    it('leaves the run resumable after a refusal — the pause is never consumed', async () => {
        const runId = await pause();
        const bad = await engine.resume(runId, { variables: {} });
        expect(bad.success).toBe(false);
        // The screen is still fetchable…
        expect(engine.getSuspendedScreen(runId)?.nodeId).toBe('ask');
        // …and the legitimate submission still lands.
        const good = await engine.resume(runId, { variables: { kind: 'normal' } });
        expect(good.success).toBe(true);
    });

    it('reports EVERY violation at once, not just the first', async () => {
        const runId = await pause();
        const res = await engine.resume(runId, { variables: { escalation_reason: 'x', bogus: 1 } });
        expect(res.success).toBe(false);
        // `kind` missing (required, unconditional) AND `bogus` undeclared.
        expect(res.error).toContain('kind');
        expect(res.error).toContain('bogus');
    });
});

describe('screen resume validation — screens that declare no contract (#4477)', () => {
    function flowWith(nodeConfig: Record<string, unknown>) {
        return {
            name: 'no_contract', label: 'No contract', type: 'screen', status: 'active', version: 1,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'ask', type: 'screen', label: 'Ask', config: nodeConfig },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ask', type: 'default' },
                { id: 'e2', source: 'ask', target: 'end', type: 'default' },
            ],
        };
    }

    it('leaves a MESSAGE-ONLY screen a pass-through — it declares no keys, so it constrains none', async () => {
        const engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('no_contract', flowWith({ title: 'Confirm', waitForInput: true }) as any);
        const started = await engine.execute('no_contract', {} as any);
        expect(started.status).toBe('paused');
        const res = await engine.resume(started.runId!, { variables: { acknowledged: true } });
        expect(res.success).toBe(true);
    });

    it('leaves an OBJECT-FORM screen a pass-through — the client persists the record and resumes with the id', async () => {
        // Its `fields` is `[]` by construction; validating against that would
        // reject the `idVariable` binding as an undeclared key, and the object's
        // own `required` fields are enforced on the write path (ADR-0113).
        const engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('no_contract', flowWith({
            objectName: 'crm_account', mode: 'create', idVariable: 'account_id',
        }) as any);
        const started = await engine.execute('no_contract', {} as any);
        expect(started.status).toBe('paused');
        expect(started.screen?.kind).toBe('object-form');
        const res = await engine.resume(started.runId!, { variables: { account_id: 'acc_1' } });
        expect(res.success).toBe(true);
    });
});

describe('screen resume validation — visibleWhen edge cases (#4477)', () => {
    /** A conditional-required field whose predicate references a variable that
     *  is neither submitted nor in the run's snapshot. */
    function flowWithPredicate(visibleWhen: string) {
        return {
            name: 'pred', label: 'Pred', type: 'screen', status: 'active', version: 1,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'ask', type: 'screen', label: 'Ask',
                    config: { fields: [{ name: 'note', label: 'Note', type: 'text', required: true, visibleWhen }] },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ask', type: 'default' },
                { id: 'e2', source: 'ask', target: 'end', type: 'default' },
            ],
        };
    }

    async function resumeWith(visibleWhen: string, bag: Record<string, unknown>) {
        const engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('pred', flowWithPredicate(visibleWhen) as any);
        const started = await engine.execute('pred', {} as any);
        return engine.resume(started.runId!, { variables: bag });
    }

    it('does not fire `required` for a field whose predicate is FALSE', async () => {
        expect((await resumeWith('false', {})).success).toBe(true);
    });

    it('fires `required` for a field whose predicate is TRUE', async () => {
        const res = await resumeWith('true', {});
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
    });

    it('does NOT reject when the predicate cannot be evaluated — the client decides what was shown', async () => {
        // An unevaluable predicate is not evidence the field was on screen, so
        // treating it as visible would reject a submission the user could never
        // have completed — #3528's dead-end, moved server-side. Logged loudly
        // instead (see `refuseInvalidScreenInput`).
        const res = await resumeWith('nonexistent_var.deep.path == 1', {});
        expect(res.success).toBe(true);
    });

    it('still refuses an undeclared key on a screen whose predicate is unevaluable', async () => {
        // The `required` degradation is scoped to `required` — the undeclared-key
        // half of the contract does not depend on any predicate.
        const res = await resumeWith('nonexistent_var.deep.path == 1', { note: 'x', rogue: 1 });
        expect(res.success).toBe(false);
        expect(res.error).toContain('rogue');
    });

    it('evaluates the predicate against the SUBMITTED values, not just the snapshot', async () => {
        // `kind` exists only in this submission; the run's variable snapshot has
        // nothing. A predicate resolved against the snapshot alone would read
        // the field as hidden and let the missing value through.
        const engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('triage', triageFlow() as any);
        const started = await engine.execute('triage', {} as any);
        const res = await engine.resume(started.runId!, { variables: { kind: 'escalate' } });
        expect(res.success).toBe(false);
        expect(res.error).toContain('escalation_reason');
    });
});
