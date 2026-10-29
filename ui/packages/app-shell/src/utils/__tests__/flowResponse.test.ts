/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The flow trigger/resume response rule, once (#2958). Three hand-rolled copies
 * existed and only one was complete; these cases pin the shapes the two
 * incomplete ones got wrong.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner } from '@object-ui/core';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { ApiErrorSchema, FlowFailureDetailsSchema } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';
import { apiActionFailureMessage, flowSuccessCopy, interpretFlowResponse, judgeFlowLaunch } from '../flowResponse';

const ok = { ok: true, status: 200 };

describe('interpretFlowResponse — the reported bug: failure read as terminal success', () => {
    it('catches a flow failure hiding under HTTP 200 with an outer success:true', () => {
        // THE bug: no `status`, no `screen`, outer `success: true`. The launch
        // handlers checked only the outer envelope, so this fell through to
        // their terminal-success return — green toast, no dialog, refresh.
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: false, error: "Node 'apply' failed: Update requires an ID" },
        }, 'Flow "convert_lead"');

        expect(out.kind).toBe('failed');
        expect(out).toMatchObject({ error: "Node 'apply' failed: Update requires an ID" });
    });

    it('catches an explicit status:failed even when `success` is absent', () => {
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { status: 'failed', error: 'boom' },
        }, 'Flow "x"');
        expect(out).toMatchObject({ kind: 'failed', error: 'boom' });
    });

    it('prefers the flow-declared friendly errorMessage over the raw error', () => {
        // `flow.errorMessage` exists precisely so the user sees something other
        // than an engine stack message.
        const out = interpretFlowResponse(ok, {
            success: true,
            data: {
                success: false,
                error: "Node 'apply' failed: constraint violation on lead.status",
                errorMessage: 'This lead has already been converted.',
            },
        }, 'Flow "convert_lead"');
        expect(out).toMatchObject({ kind: 'failed', error: 'This lead has already been converted.' });
    });

    it('marks a flow failure NON-retryable — the suspension is already consumed', () => {
        const out = interpretFlowResponse(ok, {
            success: true, data: { success: false, error: 'boom' },
        }, 'Resume');
        expect(out).toMatchObject({ kind: 'failed', retryable: false });
    });
});

describe('interpretFlowResponse — transport failures stay retryable', () => {
    it('catches a non-ok status', () => {
        const out = interpretFlowResponse({ ok: false, status: 502 }, {
            success: false, error: 'gateway timeout',
        }, 'Resume');
        expect(out).toMatchObject({ kind: 'failed', error: 'gateway timeout', retryable: true });
    });

    it('catches a transport-level success:false under HTTP 200', () => {
        const out = interpretFlowResponse(ok, { success: false, error: 'no such flow' }, 'Flow "x"');
        expect(out).toMatchObject({ kind: 'failed', error: 'no such flow', retryable: true });
    });

    it('falls back to a labelled message when the body carries none', () => {
        const out = interpretFlowResponse({ ok: false, status: 500 }, null, 'Resume');
        expect(out).toMatchObject({ kind: 'failed', error: 'Resume failed (HTTP 500)' });
    });
});

/**
 * The ADR-0112 error envelope, reproduced from the producer rather than
 * imagined: `apiErrorResponse` (objectstack `packages/runtime/src/error-envelope.ts`)
 * emits `{success:false, error:{code, message, httpStatus, details?}}`, and
 * `splitSemanticCode` promotes a `details.code` into `error.code` while keeping
 * the remaining `details` keys on the wire.
 */
function errorEnvelope(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
) {
    return {
        success: false,
        error: { code, message, httpStatus: status, ...(details ? { details } : {}) },
    };
}

const RESUME_FAILED = "Node 'create_opportunity' failed: Amount must be greater than zero";

describe('interpretFlowResponse — a 400 FLOW_FAILED on resume is TERMINAL (objectui#4784)', () => {
    // objectstack#8684 moves this exact event off `200 {data:{success:false}}`
    // onto a real status code. It must land in the same class as the inner
    // envelope failure, NOT in the transport class: the engine consumed the
    // suspension (resume-once), so the wizard must not offer a retry that can
    // only reach "No suspended run". (How the runner withholds it is the
    // runner's business — since objectui#5417 it withdraws Submit and keeps the
    // dialog up, rather than closing and taking the user's input with it.)
    it('classifies it NON-retryable — keyed on the code, not on the status alone', () => {
        const out = interpretFlowResponse(
            { ok: false, status: 400 },
            errorEnvelope(400, 'FLOW_FAILED', RESUME_FAILED),
            'Resume',
        );
        expect(out).toMatchObject({ kind: 'failed', retryable: false, error: RESUME_FAILED });
    });

    it('prefers the flow-declared errorMessage from `error.details` over the raw error', () => {
        // The 200 path prefers `data.errorMessage`; the error envelope has no
        // `data`, so `error.details` is the declared carrier that survives to
        // the wire. Losing this half was the second regression #4784 names.
        const out = interpretFlowResponse(
            { ok: false, status: 400 },
            errorEnvelope(400, 'FLOW_FAILED', RESUME_FAILED, {
                errorMessage: 'This lead has already been converted.',
            }),
            'Resume',
        );
        expect(out).toMatchObject({
            kind: 'failed',
            retryable: false,
            error: 'This lead has already been converted.',
        });
    });

    it('falls back to the envelope message when no errorMessage was carried', () => {
        const out = interpretFlowResponse(
            { ok: false, status: 400 },
            errorEnvelope(400, 'FLOW_FAILED', RESUME_FAILED, { durationMs: 45 }),
            'Resume',
        );
        expect(out).toMatchObject({ kind: 'failed', error: RESUME_FAILED, retryable: false });
    });

    it('matches the pre-ADR-0112 lowercase spelling too — the console outlives one vocabulary', () => {
        const out = interpretFlowResponse(
            { ok: false, status: 400 },
            errorEnvelope(400, 'flow_failed', RESUME_FAILED),
            'Resume',
        );
        expect(out).toMatchObject({ kind: 'failed', retryable: false });
    });

    it('needs BOTH the 400 and the code — FLOW_FAILED on another status stays retryable', () => {
        // A 500 is the server saying it broke, whatever code rode along; that
        // did not consume the suspension.
        const out = interpretFlowResponse(
            { ok: false, status: 500 },
            errorEnvelope(500, 'FLOW_FAILED', 'Internal server error'),
            'Resume',
        );
        expect(out).toMatchObject({ kind: 'failed', retryable: true });
    });

    it('leaves the OTHER 400s on this route retryable — the engine refused before consuming', () => {
        // `INVALID_SCREEN_INPUT` / `INVALID_SIGNAL` are refused at the one place
        // a signal reaches the variable map, i.e. before the suspension is
        // consumed. The user fixes the input and resubmits the same run — the
        // exact case the flag exists to keep open.
        for (const code of ['INVALID_SCREEN_INPUT', 'INVALID_SIGNAL', 'VALIDATION_ERROR']) {
            const out = interpretFlowResponse(
                { ok: false, status: 400 },
                errorEnvelope(400, code, 'Field "amount" is required'),
                'Resume',
            );
            expect(out, code).toMatchObject({ kind: 'failed', retryable: true });
        }
    });
});

describe('interpretFlowResponse — a 404 is terminal for a different reason (objectui#4784)', () => {
    // NOT dormant: the route answers this today (`RUN_NOT_FOUND` → 404), and
    // every one of them had been keeping the wizard open for a retry that can
    // only 404 again.
    it('marks "no such suspended run" non-retryable, keeping the endpoint’s own message', () => {
        const out = interpretFlowResponse(
            { ok: false, status: 404 },
            errorEnvelope(404, 'RESOURCE_NOT_FOUND', 'No such suspended run'),
            'Resume',
        );
        expect(out).toMatchObject({
            kind: 'failed',
            retryable: false,
            error: 'No such suspended run',
        });
    });

    it('holds for a BARE 404 with no envelope at all — status alone decides', () => {
        // A proxy or an unmounted route answers 404 with HTML; `json` is null
        // because parsing threw. The disposition must not depend on that.
        const out = interpretFlowResponse({ ok: false, status: 404 }, null, 'Resume');
        expect(out).toMatchObject({
            kind: 'failed',
            retryable: false,
            error: 'Resume failed (HTTP 404)',
        });
    });
});

describe('interpretFlowResponse — error is ALWAYS a string (React #31)', () => {
    it('resolves the nested {code, message} object to a string', () => {
        // Handing this object to `toast.error()` puts an object where React
        // expects a child and crashes the page.
        const out = interpretFlowResponse({ ok: false, status: 403 }, {
            success: false,
            error: { message: 'Run is parked on a service-owned node', code: 'PERMISSION_DENIED' },
        }, 'Resume');
        expect(typeof (out as { error: string }).error).toBe('string');
        expect(out).toMatchObject({ error: 'Run is parked on a service-owned node' });
    });

    it('resolves a nested error object on the INNER envelope too', () => {
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: false, error: { message: 'constraint violation', code: 400 } },
        }, 'Flow "x"');
        expect(typeof (out as { error: string }).error).toBe('string');
        expect(out).toMatchObject({ error: 'constraint violation' });
    });

    it('never returns a non-string error for an object-shaped errorMessage', () => {
        // `errorMessage` is declared as a string, but the body is untyped at
        // runtime — a non-string must not be passed through as the toast child.
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: false, errorMessage: { nope: true }, error: 'the real message' },
        }, 'Flow "x"');
        expect(out).toMatchObject({ error: 'the real message' });
    });
});

describe('interpretFlowResponse — paused is not a failure', () => {
    it('reports a paused screen with its runId and screen', () => {
        const screen = { nodeId: 'confirm', title: 'Confirm', fields: [] };
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: true, status: 'paused', runId: 'run-7', screen },
        }, 'Flow "convert_lead"');

        expect(out).toMatchObject({ kind: 'paused', runId: 'run-7', screen });
    });

    it('does NOT treat a pause as terminal — a screen-less pause falls through to done', () => {
        // `status: 'paused'` with no `screen` is a non-screen suspension (an
        // approval / wait node). There is nothing for the runner to render, so
        // it must not be reported as a screen pause.
        const out = interpretFlowResponse(ok, {
            success: true, data: { success: true, status: 'paused', runId: 'run-8' },
        }, 'Flow "x"');
        expect(out.kind).toBe('done');
    });
});

describe('interpretFlowResponse — terminal success', () => {
    it('exposes the AutomationResult as `data`, unchanged', () => {
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: true, status: 'completed', output: { id: 'opp_1' }, durationMs: 12 },
        }, 'Flow "convert_lead"');

        expect(out).toMatchObject({
            kind: 'done',
            data: { success: true, status: 'completed', output: { id: 'opp_1' }, durationMs: 12 },
        });
    });

    it('surfaces the flow-declared successMessage', () => {
        const out = interpretFlowResponse(ok, {
            success: true, data: { success: true, successMessage: 'Lead converted.' },
        }, 'Flow "x"');
        expect(out).toMatchObject({ kind: 'done', successMessage: 'Lead converted.' });
    });

    it('leaves `data` undefined when the body carried none — not an invented {}', () => {
        // `ActionResult.data` has always exposed the raw `body.data`; the launch
        // handlers returned `json?.data` and consumers may test for absence.
        const out = interpretFlowResponse(ok, { success: true }, 'Flow "x"');
        expect(out).toMatchObject({ kind: 'done' });
        expect((out as { data?: unknown }).data).toBeUndefined();
    });
});

// objectui#9973 — what a flow LAUNCH does with its response, decided once for
// both console launch handlers. Each arm's `result` is asserted with `toEqual`,
// not `toMatchObject`: the byte shape IS the contract with the ActionRunner (a
// stray `data` or `reload` on the refused arm is a success side effect).
describe('judgeFlowLaunch — one launch decision for both hosts', () => {
    const judge = (json: unknown, refreshAfter?: boolean) =>
        judgeFlowLaunch(interpretFlowResponse(ok, json, 'Flow "check_dup"'), refreshAfter);

    it('refused: silent success, the sentence handed to the notice, NO refresh', () => {
        const out = judge({
            success: true,
            data: { success: true, status: 'refused', refusalMessage: 'Refused: Acme Corp is a confirmed duplicate' },
        });
        // Byte-identical to the paused arm: `silent` keeps the action's
        // `successMessage` toast off, `handedOff` keeps its `onSuccess` hop
        // from firing (objectstack#25800), and nothing else rides along.
        expect(out.result).toEqual({ success: true, silent: true, handedOff: true });
        expect(out.followUp).toEqual({ kind: 'refusal', message: 'Refused: Acme Corp is a confirmed duplicate' });
        expect(out.refresh).toBe(false);
    });

    it('refused: an action that did not opt out of refresh STILL does not refresh', () => {
        // The run wrote nothing; `refreshAfter` governs completed runs only.
        expect(judge({ success: true, data: { success: true, status: 'refused', refusalMessage: 'No.' } }, true).refresh)
            .toBe(false);
    });

    it('refused with no sentence: the disposition is the STATUS, the message is empty', () => {
        const out = judge({ success: true, data: { success: true, status: 'refused' } });
        expect(out.result).toEqual({ success: true, silent: true, handedOff: true });
        expect(out.followUp).toEqual({ kind: 'refusal', message: '' });
    });

    it('paused: unchanged — silent success, the screen handed to FlowRunner, no refresh', () => {
        const screen = { nodeId: 'collect', title: 'New Assignee', fields: [] };
        const out = judge({ success: true, data: { success: true, status: 'paused', runId: 'run-7', screen } });
        expect(out.result).toEqual({ success: true, silent: true, handedOff: true });
        expect(out.followUp).toEqual({ kind: 'screen', runId: 'run-7', screen });
        expect(out.refresh).toBe(false);
    });

    it('completed (the control): terminal success with the AutomationResult as data, and a refresh', () => {
        const data = { success: true, status: 'completed' };
        const out = judge({ success: true, data });
        expect(out.result).toEqual({ success: true, data, reload: true });
        expect(out.followUp).toBeUndefined();
        expect(out.refresh).toBe(true);
    });

    it('completed with refreshAfter: false: no refresh, and the runner is told so', () => {
        const out = judge({ success: true, data: { success: true, status: 'completed' } }, false);
        expect(out.result).toMatchObject({ success: true, reload: false });
        expect(out.refresh).toBe(false);
    });

    it('failed: the error for the runner to toast, no follow-up, no refresh', () => {
        const out = judge({ success: true, data: { success: false, error: "Node 'apply' failed" } });
        expect(out.result).toEqual({ success: false, error: "Node 'apply' failed" });
        expect(out.followUp).toBeUndefined();
        expect(out.refresh).toBe(false);
    });
});

// objectstack#25800 — a `type: 'flow'` action may declare `onSuccess`, and its
// hop follows a COMPLETED run only. Each arm is judged from a real wire body and
// its result handed to a real `ActionRunner` (the one the console builds), with
// the router replaced by a spy: the hop is read off the navigation call itself,
// never off a flag the test computes.
describe('judgeFlowLaunch → ActionRunner — the onSuccess hop follows a completed run only', () => {
    const RENEWAL_ID = 'ctr_0018';
    const ACTION = {
        type: 'flow',
        name: 'start_renewal',
        target: 'renewal_start',
        onSuccess: { navigate: '/apps/clm/clm_contract/record/${result.output.renewal.id}', openIn: 'self' },
    };

    /** Judge `json` as the launch host does, and let the runner act on the result. */
    async function run(json: unknown, actionSuccessMessage?: string) {
        const judged = judgeFlowLaunch(
            interpretFlowResponse(ok, json, 'Flow "renewal_start"'),
            undefined,
            actionSuccessMessage,
        );
        const nav = vi.fn();
        const runner = new ActionRunner({});
        runner.setNavigationHandler(nav as never);
        runner.setToastHandler(vi.fn() as never);
        runner.registerHandler('flow', async () => judged.result);
        const result = await runner.execute({ ...ACTION, successMessage: actionSuccessMessage } as never);
        return { judged, result, navigated: nav.mock.calls.map(([url]) => url as string) };
    }

    const completed = (extra: Record<string, unknown> = {}) => ({
        success: true,
        data: { success: true, status: 'completed', output: { renewal: { id: RENEWAL_ID, renewed_from: 'ctr_0001' } }, ...extra },
    });

    it('done: the hop lands on the record the run produced, read off the run\'s `output`', async () => {
        const { judged, result, navigated } = await run(completed(), 'Renewal draft created');
        expect(judged.result.handedOff).toBeUndefined();
        expect(result.success).toBe(true);
        expect(navigated).toEqual([`/apps/clm/clm_contract/record/${RENEWAL_ID}`]);
    });

    it("done with the flow's own copy: `silent` is about the toast, so the run still hops", async () => {
        const { judged, navigated } = await run(completed({ successMessage: 'Renewal draft created' }));
        expect(judged.result.silent).toBe(true);
        expect(judged.successToast).toBe('Renewal draft created');
        expect(navigated).toEqual([`/apps/clm/clm_contract/record/${RENEWAL_ID}`]);
    });

    it('paused at a screen: a hand-off, so no hop while the wizard is open', async () => {
        const screen = { nodeId: 'confirm', title: 'Confirm renewal', fields: [] };
        const { judged, result, navigated } = await run({
            success: true, data: { success: true, status: 'paused', runId: 'run-9', screen },
        });
        expect(judged.followUp).toMatchObject({ kind: 'screen', runId: 'run-9' });
        expect(result.success).toBe(true);
        expect(navigated).toEqual([]);
    });

    it('ended refused: a hand-off to the notice, so no hop past it', async () => {
        const { judged, result, navigated } = await run({
            success: true,
            data: { success: true, status: 'refused', refusalMessage: 'MSA-2026-0007 already has a renewal draft MSA-2026-0018' },
        });
        expect(judged.followUp).toMatchObject({ kind: 'refusal' });
        expect(result.success).toBe(true);
        expect(navigated).toEqual([]);
    });

    it('failed: no success, so no hop', async () => {
        const { result, navigated } = await run({ success: true, data: { success: false, error: "Node 'create' failed" } });
        expect(result.success).toBe(false);
        expect(navigated).toEqual([]);
    });

    it("a flow that declares no `isOutput` variable answers `output: {}`, and the path resolves to ''", async () => {
        // The authoring gap the card's hotclm report hit: a `create_record`
        // node's `outputVariable` that is not declared `isOutput: true` never
        // reaches `output`. The runner's one rule for a nullish path applies
        // (`''`), so the hop lands on the bare collection path, not on a
        // literal `${result.output.renewal.id}`.
        const { navigated } = await run({ success: true, data: { success: true, status: 'completed', output: {} } });
        expect(navigated).toEqual(['/apps/clm/clm_contract/record/']);
    });
});

// objectui#11092 — the flow's served label (`AutomationResult.flowLabel`) is
// lifted here once, so both launch hosts and the runner's resume read it the
// same way. The arms are asserted by kind, and the launch follow-up with
// `toEqual`, as above: the label rides along with the screen, nothing else does.
describe('the served flowLabel is lifted once (objectui#11092)', () => {
    const screen = { nodeId: 'collect', title: 'New Assignee', fields: [] };

    it('a paused answer carries it', () => {
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: true, status: 'paused', runId: 'run-7', screen, flowLabel: 'Reassign' },
        }, 'Flow "reassign"');
        expect(out).toMatchObject({ kind: 'paused', flowLabel: 'Reassign' });
    });

    it('a terminal-success answer carries it', () => {
        const out = interpretFlowResponse(ok, {
            success: true, data: { success: true, flowLabel: 'Reassign' },
        }, 'Flow "reassign"');
        expect(out).toMatchObject({ kind: 'done', flowLabel: 'Reassign' });
    });

    it('is undefined when the answer serves no label, and when what it serves is not a string', () => {
        const none = interpretFlowResponse(ok, { success: true, data: { success: true } }, 'Flow "x"');
        expect((none as { flowLabel?: unknown }).flowLabel).toBeUndefined();
        const notString = interpretFlowResponse(ok, {
            success: true, data: { success: true, status: 'paused', runId: 'r', screen, flowLabel: { en: 'x' } },
        }, 'Flow "x"');
        expect(notString.kind).toBe('paused');
        expect((notString as { flowLabel?: unknown }).flowLabel).toBeUndefined();
    });

    it('a paused LAUNCH hands it to the runner with the screen', () => {
        const out = judgeFlowLaunch(interpretFlowResponse(ok, {
            success: true,
            data: { success: true, status: 'paused', runId: 'run-7', screen, flowLabel: 'Reassign' },
        }, 'Flow "reassign"'), undefined);
        expect(out.followUp).toEqual({ kind: 'screen', runId: 'run-7', screen, flowLabel: 'Reassign' });
        expect(out.result).toEqual({ success: true, silent: true, handedOff: true });
    });
});

// objectui#12274 — a run's success copy follows ONE precedence however the run
// ends: the action's `successMessage`, then the flow's own. `FlowRunner`'s
// terminal toast (a paused run) and the launch's `done` arm (a straight-through
// run) both call `flowSuccessCopy`. On the launch the answer decides who speaks:
// the ActionRunner for the action's copy and its own default (the result is
// byte-identical to before), the console for the flow's copy (`silent` +
// `successToast`). The rendered toasts are pinned per host beside
// objectui#12234's pins (`*.flowDoneSuccessMessage-12274.test.tsx`).
describe('flowSuccessCopy — the one precedence (objectui#12274)', () => {
    it("the action's copy wins over the flow's", () => {
        expect(flowSuccessCopy('Case escalated', 'Escalation recorded'))
            .toEqual({ text: 'Case escalated', from: 'action' });
    });

    it("the flow's copy speaks when the action declares none", () => {
        expect(flowSuccessCopy(undefined, 'Escalation recorded'))
            .toEqual({ text: 'Escalation recorded', from: 'flow' });
    });

    it('a blank or unlocalized action copy counts as none', () => {
        expect(flowSuccessCopy('   ', 'Escalation recorded')).toEqual({ text: 'Escalation recorded', from: 'flow' });
        expect(flowSuccessCopy({ en: 'Case escalated' }, 'Escalation recorded'))
            .toEqual({ text: 'Escalation recorded', from: 'flow' });
    });

    it('neither usable: no copy, so the caller speaks its own default', () => {
        expect(flowSuccessCopy(undefined, undefined)).toBeUndefined();
        expect(flowSuccessCopy('', '  ')).toBeUndefined();
    });
});

describe("judgeFlowLaunch — a straight-through run's success copy (objectui#12274)", () => {
    const done = (data: Record<string, unknown>, actionMessage?: unknown, refreshAfter?: boolean) =>
        judgeFlowLaunch(
            interpretFlowResponse(ok, { success: true, data }, 'Flow "case_escalate"'),
            refreshAfter,
            actionMessage,
        );

    it("the action's copy wins: the result is unchanged, so the runner speaks it", () => {
        const data = { success: true, status: 'completed', successMessage: 'Escalation recorded' };
        const out = done(data, 'Case escalated');
        expect(out.result).toEqual({ success: true, data, reload: true });
        expect(out.successToast).toBeUndefined();
        expect(out.refresh).toBe(true);
    });

    it("only the flow declares copy: the result is silent and carries the flow's copy to speak", () => {
        const data = { success: true, status: 'completed', successMessage: 'Escalation recorded' };
        const out = done(data, undefined);
        expect(out.result).toEqual({ success: true, data, reload: true, silent: true });
        expect(out.successToast).toBe('Escalation recorded');
        expect(out.followUp).toBeUndefined();
        expect(out.refresh).toBe(true);
    });

    it("the flow's copy does not touch refreshAfter: false", () => {
        const out = done({ success: true, status: 'completed', successMessage: 'Escalation recorded' }, undefined, false);
        expect(out.result).toMatchObject({ success: true, reload: false, silent: true });
        expect(out.refresh).toBe(false);
    });

    it('neither declares copy: the result is unchanged, so the runner speaks its default', () => {
        const data = { success: true, status: 'completed' };
        const out = done(data, undefined);
        expect(out.result).toEqual({ success: true, data, reload: true });
        expect(out.successToast).toBeUndefined();
    });

    it('refused and failed runs carry no success toast, whatever the flow declares', () => {
        const refused = done({ success: true, status: 'refused', refusalMessage: 'No.', successMessage: 'Escalation recorded' });
        expect(refused.result).toEqual({ success: true, silent: true, handedOff: true });
        expect(refused.successToast).toBeUndefined();
        const failed = done({ success: false, error: 'boom', successMessage: 'Escalation recorded' });
        expect(failed.result).toEqual({ success: false, error: 'boom' });
        expect(failed.successToast).toBeUndefined();
    });
});

describe("interpretFlowResponse — the flow's own toasts in the active language (objectui#12075)", () => {
    // `flows.FLOW.successMessage` / `errorMessage` (objectstack#22507). The
    // bundle shape is the spec's `TranslationBundle`, keyed by locale.
    const copy = {
        flowName: 'case_escalate',
        locale: 'zh-CN',
        bundle: {
            'zh-CN': {
                flows: { case_escalate: { successMessage: '工单已升级', errorMessage: '升级失败' } },
            },
        },
    };

    it('translates the served successMessage on a done run, and the launch speaks the translation', () => {
        const json = { success: true, data: { success: true, status: 'completed', successMessage: 'Case escalated' } };
        const out = interpretFlowResponse(ok, json, 'Flow "case_escalate"', copy);
        expect(out).toMatchObject({ kind: 'done', successMessage: '工单已升级' });
        expect(judgeFlowLaunch(out, undefined).successToast).toBe('工单已升级');
    });

    it('translates the authored errorMessage on a 200 flow failure', () => {
        const out = interpretFlowResponse(ok, {
            success: true,
            data: { success: false, error: 'boom', errorMessage: 'Escalation failed' },
        }, 'Resume', copy);
        expect(out).toMatchObject({ kind: 'failed', retryable: false, error: '升级失败' });
    });

    it('translates the authored errorMessage carried in a 400 FLOW_FAILED envelope', () => {
        const out = interpretFlowResponse(
            { ok: false, status: 400 },
            errorEnvelope(400, 'FLOW_FAILED', 'engine prose', { errorMessage: 'Escalation failed' }),
            'Resume',
            copy,
        );
        expect(out).toMatchObject({ kind: 'failed', retryable: false, error: '升级失败' });
    });

    it('adds no toast the flow does not author, and leaves the engine prose untranslated', () => {
        const done = interpretFlowResponse(ok, { success: true, data: { success: true } }, 'Flow "x"', copy);
        expect(done).toMatchObject({ kind: 'done', successMessage: undefined });
        const failed = interpretFlowResponse(ok, { success: true, data: { success: false, error: 'boom' } }, 'Resume', copy);
        expect(failed).toMatchObject({ kind: 'failed', error: 'boom' });
    });

    it('answers the served strings where the bundle carries no key, or there is no bundle', () => {
        const json = { success: true, data: { success: true, status: 'completed', successMessage: 'Case escalated' } };
        const otherFlow = { ...copy, flowName: 'other_flow' };
        expect(interpretFlowResponse(ok, json, 'Flow "other_flow"', otherFlow)).toMatchObject({ successMessage: 'Case escalated' });
        expect(interpretFlowResponse(ok, json, 'Flow "case_escalate"', { ...copy, bundle: undefined }))
            .toMatchObject({ successMessage: 'Case escalated' });
        expect(interpretFlowResponse(ok, json, 'Flow "case_escalate"')).toMatchObject({ successMessage: 'Case escalated' });
    });
});

// objectui#13367 — the invoking action's `successMessage` may arrive as the
// `template` envelope (objectstack#24814). Read as "not a string", it fell to
// the flow's own copy, so the author's sentence never showed on a flow action.
describe("flowSuccessCopy — the action's copy as a template envelope (objectui#13367)", () => {
    it("an envelope's source wins over the flow's copy, as written", () => {
        expect(flowSuccessCopy({ dialect: 'template', source: 'Escalated {{ record.name }}' }, 'Escalation recorded'))
            .toEqual({ text: 'Escalated {{ record.name }}', from: 'action' });
    });

    it('an envelope with no text counts as none', () => {
        expect(flowSuccessCopy({ dialect: 'template' }, 'Escalation recorded'))
            .toEqual({ text: 'Escalation recorded', from: 'flow' });
    });

    it('on a straight-through run the result is unchanged, so the runner speaks the envelope', () => {
        const data = { success: true, status: 'completed', successMessage: 'Escalation recorded' };
        const out = judgeFlowLaunch(
            interpretFlowResponse(ok, { success: true, data }, 'Flow "case_escalate"'),
            undefined,
            { dialect: 'template', source: 'Escalated {{ record.name }}' },
        );
        expect(out.result).toEqual({ success: true, data, reload: true });
        expect(out.successToast).toBeUndefined();
    });
});

// objectstack#24914 ruling B′ — a refusal a flow's write node met reads like
// the same refusal on a record save: the authored `errorMessage`, then the
// producer-marked `userMessage`, then the inner refusal (permission → the
// form's localized line), then `message`.
describe('interpretFlowResponse — a refusal met inside the run, by the record-save rule (objectstack#24914)', () => {
    // Every pack resident, so the `zh` case reads the catalogue a Chinese
    // console has loaded.
    registerBuiltInLocales();

    // The door's own constants (objectstack `packages/runtime/src/flow-failed-inner-refusal.test.ts`).
    const INNER_MESSAGE =
        "Duplicate record refused on 'crm_account': a unique constraint already holds these values. No record was written.";
    const RAW_ERROR = `Node 'create_account' failed: create_record(crm_account) failed: ${INNER_MESSAGE}`;
    const USER_TEXT = '该客户名称已被另一位销售代表占用，请联系主管。';
    const UNIQUE = { code: 'UNIQUE_VIOLATION', message: INNER_MESSAGE } as const;
    const DENIED = { code: 'PERMISSION_DENIED', message: 'insufficient privileges to create crm_account' } as const;
    const RULE = { code: 'VALIDATION_FAILED', message: 'Account name must not contain a URL.' } as const;

    /** The trigger/resume door's `400 FLOW_FAILED`, proven real by the spec's own schemas. */
    function flowFailed(details: Record<string, unknown>, userMessage?: string) {
        const error = {
            code: 'FLOW_FAILED',
            message: RAW_ERROR,
            httpStatus: 400,
            ...(userMessage ? { userMessage } : {}),
            details,
        };
        expect(ApiErrorSchema.safeParse(error).error?.issues).toBeUndefined();
        expect(FlowFailureDetailsSchema.safeParse(details).error?.issues).toBeUndefined();
        return { success: false, error };
    }
    const failed400 = (json: unknown, copy?: Parameters<typeof interpretFlowResponse>[3]) =>
        interpretFlowResponse({ ok: false, status: 400 }, json, 'Resume', copy);

    it('a unique refusal shows the inner sentence, without the node and operation wrapper', () => {
        expect(failed400(flowFailed({ innerRefusal: UNIQUE }))).toEqual({
            kind: 'failed', error: INNER_MESSAGE, retryable: false,
        });
    });

    it("a validation refusal shows the author's rule text", () => {
        expect(failed400(flowFailed({ innerRefusal: RULE }))).toMatchObject({ error: RULE.message });
    });

    it("a permission refusal shows the record form's localized line, never the server prose", () => {
        const en = failed400(flowFailed({ innerRefusal: DENIED }));
        expect(en).toMatchObject({ error: builtInLocales.en.form.noPermissionToSave });

        const zh = failed400(flowFailed({ innerRefusal: DENIED }), { flowName: 'convert', bundle: undefined, locale: 'zh-CN' });
        expect(zh).toMatchObject({ error: builtInLocales.zh.form.noPermissionToSave });
        expect((zh as { error: string }).error).not.toContain('crm_account');
    });

    // objectstack#26059 Q3: a delegated admin's out-of-scope write is the one
    // denial whose reason is shown; it describes only the caller's own scope.
    it('a delegated-admin scope refusal shows the server reason, not the fixed permission line', () => {
        const SCOPE_REASON =
            "Outside your delegated scope: delegated 'create' on sys_user_position rejected — business unit 'bu_west' is outside the delegated subtree (scope from 'regional_admin').";
        const SCOPE = { code: 'DELEGATION_SCOPE_VIOLATION', message: `[Security] ${SCOPE_REASON}` } as const;

        expect(failed400(flowFailed({ innerRefusal: SCOPE }))).toEqual({
            kind: 'failed', error: SCOPE_REASON, retryable: false,
        });
        const on200 = interpretFlowResponse(ok, {
            success: true,
            data: { success: false, status: 'failed', error: RAW_ERROR, innerRefusal: SCOPE },
        }, 'Flow "assign"');
        expect(on200).toMatchObject({ kind: 'failed', error: SCOPE_REASON });
        // Control: a plain denial on the same path still reads the fixed line.
        expect(failed400(flowFailed({ innerRefusal: DENIED }))).toMatchObject({ error: builtInLocales.en.form.noPermissionToSave });
    });

    it('a producer-marked userMessage wins over the inner refusal, verbatim', () => {
        expect(failed400(flowFailed({ innerRefusal: UNIQUE }, USER_TEXT))).toMatchObject({ error: USER_TEXT });
        expect(failed400(flowFailed({ innerRefusal: DENIED }, USER_TEXT))).toMatchObject({ error: USER_TEXT });
    });

    it("the flow's authored errorMessage still wins over both", () => {
        const json = flowFailed({ errorMessage: 'Conversion failed.', innerRefusal: UNIQUE }, USER_TEXT);
        expect(failed400(json)).toMatchObject({ error: 'Conversion failed.' });
    });

    it('an envelope without the members falls back to message, never to silence', () => {
        expect(failed400(flowFailed({}))).toMatchObject({ error: RAW_ERROR });
    });

    it('the 200 failed arm reads the same members off the run, in the same order', () => {
        const run = (extra: Partial<AutomationResult>): AutomationResult => ({
            success: false, status: 'failed', error: RAW_ERROR, ...extra,
        });
        const on200 = (data: AutomationResult) => interpretFlowResponse(ok, { success: true, data }, 'Flow "convert"');

        expect(on200(run({ innerRefusal: UNIQUE }))).toMatchObject({ kind: 'failed', error: INNER_MESSAGE, retryable: false });
        expect(on200(run({ innerRefusal: DENIED }))).toMatchObject({ error: builtInLocales.en.form.noPermissionToSave });
        expect(on200(run({ innerRefusal: UNIQUE, userMessage: USER_TEXT }))).toMatchObject({ error: USER_TEXT });
        expect(on200(run({ innerRefusal: UNIQUE, userMessage: USER_TEXT, errorMessage: 'Conversion failed.' })))
            .toMatchObject({ error: 'Conversion failed.' });
        expect(on200(run({}))).toMatchObject({ error: RAW_ERROR });
    });
});

describe('apiActionFailureMessage — a flow-backed api action reads the run refusal, not the node chain (objectstack#27487)', () => {
    registerBuiltInLocales();

    // The card's toast: a map item's subflow met the refusal on its update.
    const REFUSAL = 'You do not have permission to perform this action. Contact your administrator if you need access.';
    const ONE_LEVEL = `Node 'write_estimate' failed: update_record(showcase_task) failed: ${REFUSAL}`;
    const NESTED = "Node 'recalc_each' failed: map 'recalc_each': item 0 (subflow 'showcase_recalc_task_estimate') failed: "
        + ONE_LEVEL;
    const DENIED = { code: 'PERMISSION_DENIED', message: REFUSAL } as const;
    const RULE = { code: 'VALIDATION_FAILED', message: 'Estimate must be a positive number.' } as const;

    /** A declared `type: 'flow'` endpoint's `400 FLOW_FAILED`, proven real by the spec's own schemas. */
    function endpointFailed(message: string, details: Record<string, unknown>, userMessage?: string) {
        const error = {
            code: 'FLOW_FAILED',
            message,
            httpStatus: 400,
            ...(userMessage ? { userMessage } : {}),
            details,
        };
        expect(ApiErrorSchema.safeParse(error).error?.issues).toBeUndefined();
        expect(FlowFailureDetailsSchema.safeParse(details).error?.issues).toBeUndefined();
        return { success: false, error };
    }
    const on400 = (json: unknown, locale?: string) => apiActionFailureMessage({ status: 400 }, json, 'HTTP 400', locale);

    it("a one-level permission refusal reads the record form's line, in the host's language", () => {
        expect(on400(endpointFailed(ONE_LEVEL, { innerRefusal: DENIED }))).toBe(builtInLocales.en.form.noPermissionToSave);
        expect(on400(endpointFailed(ONE_LEVEL, { innerRefusal: DENIED }), 'zh-CN')).toBe(builtInLocales.zh.form.noPermissionToSave);
    });

    it('the nested map → subflow chain reads the same line once the inner refusal is carried', () => {
        const shown = on400(endpointFailed(NESTED, { innerRefusal: DENIED }));
        expect(shown).toBe(builtInLocales.en.form.noPermissionToSave);
        expect(shown).not.toContain("Node '");
        expect(shown).not.toContain('subflow');
    });

    it("a non-permission refusal reads its own sentence; a userMessage and the flow's errorMessage outrank it", () => {
        expect(on400(endpointFailed(NESTED, { innerRefusal: RULE }))).toBe(RULE.message);
        expect(on400(endpointFailed(NESTED, { innerRefusal: DENIED }, 'Ask your lead to recalculate.')))
            .toBe('Ask your lead to recalculate.');
        expect(on400(endpointFailed(NESTED, { errorMessage: 'Recalculation failed.', innerRefusal: DENIED })))
            .toBe('Recalculation failed.');
    });

    it('an envelope without the members falls back to its message, never to silence', () => {
        expect(on400(endpointFailed(NESTED, {}))).toBe(NESTED);
    });

    it('every other answer reads the envelope as the door always has', () => {
        const denied = { success: false, error: { code: 'PERMISSION_DENIED', message: 'Forbidden', details: { innerRefusal: RULE } } };
        expect(apiActionFailureMessage({ status: 403 }, denied, 'HTTP 403', 'en')).toBe('Forbidden');
        // A 400 that is not FLOW_FAILED does not read flow carriers either.
        const invalid = { success: false, error: { code: 'VALIDATION_FAILED', message: 'Bad body', details: { innerRefusal: RULE } } };
        expect(apiActionFailureMessage({ status: 400 }, invalid, 'HTTP 400', 'en')).toBe('Bad body');
        expect(apiActionFailureMessage({ status: 502 }, null, 'HTTP 502', 'en')).toBe('HTTP 502');
    });
});
