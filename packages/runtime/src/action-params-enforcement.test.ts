// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `enforceActionParams` — the ADR-0104 D2 gate itself, not its validator
 * (commit 066dd3bd0).
 *
 * ## What was measured, and why this file exists
 *
 * The card that produced this file claimed neither `seedFlowActionParams` nor
 * `enforceActionParams` was named by any test. Grep cannot settle that — a pin
 * can live in a file that never names the function — so both were ABLATED
 * instead, repo-wide against `packages/runtime`'s 217 files / 3143 tests:
 *
 *  - `seedFlowActionParams`, gutted → **5 tests red** in
 *    `http-dispatcher.actions-type-dispatch.test.ts`. Pinned all along,
 *    indirectly, through the REST route. The claim was wrong about it.
 *  - `enforceActionParams`, replaced with an unconditional `return null` (the
 *    gate accepting every bag) → **3143 passed, 0 failed**. Nothing in the repo
 *    noticed the param contract had stopped existing.
 *
 * The VALIDATOR is thoroughly pinned — `@objectstack/spec`'s
 * `action-params.test.ts` covers `validateActionParams` case by case. What had
 * no pin is the runtime GATE wrapped around it, and the gate is where the
 * decisions live that the validator never makes: the param-less pass-through,
 * the strict-by-default rejection, and the `OS_ALLOW_LAX_ACTION_PARAMS` escape
 * hatch. A green validator says nothing about whether anything still calls it.
 *
 * That gap matters more than a missing unit test usually does: this gate is
 * what stops an AI/MCP caller's plausible-but-wrong bag from reaching an
 * action body (#3438), and its only other mention outside the source is a
 * MANUALLY-run platform-checklist clause. So it is pinned here at the level
 * the ablation showed to be empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforceActionParams, type ActionExecutionDeps } from './action-execution.js';

/** `enforceActionParams` reaches nothing on `deps` — it only forwards it. */
const NO_DEPS = undefined as unknown as ActionExecutionDeps;

/** No parent object schema: an object-less action carrying inline params only. */
const NO_OBJECT = undefined;

const WHERE = { objectName: 'crm_lead', actionName: 'convert_lead' };

const REQUIRES_TITLE = {
    name: 'convert_lead',
    params: [{ name: 'title', type: 'text', required: true }],
};

describe('enforceActionParams — the ADR-0104 D2 gate (#14864)', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('anti-vacuity control: a CONFORMING bag against declared params is accepted', () => {
        // Positive control for the rejection below. Without it, a gate that
        // rejected everything, or one that had stopped resolving params at
        // all, would still satisfy "rejects a bad bag".
        expect(enforceActionParams(NO_DEPS, REQUIRES_TITLE, NO_OBJECT, { title: 'Hi' }, WHERE)).toBeNull();
    });

    it('rejects a bag that violates the declared contract, naming the param', () => {
        const error = enforceActionParams(NO_DEPS, REQUIRES_TITLE, NO_OBJECT, {}, WHERE);
        expect(error).toContain('Invalid action params');
        expect(error).toContain('title');
    });

    it('passes a HANDLER action that declares NO params straight through', () => {
        // The documented compatibility leg: nothing to validate against, so a
        // param-less handler action is untouched however odd its bag looks.
        expect(enforceActionParams(NO_DEPS, { name: 'ping' }, NO_OBJECT, { anything: 1 }, WHERE)).toBeNull();
        expect(enforceActionParams(NO_DEPS, { name: 'ping', params: [] }, NO_OBJECT, { anything: 1 }, WHERE)).toBeNull();
    });

    describe('[#24268] a param-less DECLARATIVE UPDATE has an empty accept set, not an absent one', () => {
        // Its bag is merged over `patch` and written to the row, so what it
        // declares is its whole wire write set. Both spellings of "declares
        // none" — the key absent, and an empty list — are the same verdict.
        const CLOSE = { name: 'close_case', operation: 'update', patch: { status: 'closed' } };
        const CLOSE_EMPTY_LIST = { ...CLOSE, params: [] };

        it('refuses an undeclared key, naming it — through the same strict path', () => {
            for (const action of [CLOSE, CLOSE_EMPTY_LIST]) {
                const error = enforceActionParams(NO_DEPS, action, NO_OBJECT, { subject: 'x' }, WHERE);
                expect(error).toContain('Invalid action params');
                expect(error).toContain('"subject"');
            }
        });

        it('accepts the empty bag, and the dispatcher built-ins, exactly as the D2 validator allowlists them', () => {
            // The positive controls for the refusal above: a gate that refused
            // EVERY bag on an update would pass "refuses an undeclared key".
            for (const action of [CLOSE, CLOSE_EMPTY_LIST]) {
                expect(enforceActionParams(NO_DEPS, action, NO_OBJECT, {}, WHERE)).toBeNull();
                expect(enforceActionParams(NO_DEPS, action, NO_OBJECT, { recordId: 'r1', objectName: 'crm_case' }, WHERE))
                    .toBeNull();
            }
        });

        it('`OS_ALLOW_LAX_ACTION_PARAMS=1` accepts it and warns — the one escape hatch, no switch of its own', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.stubEnv('OS_ALLOW_LAX_ACTION_PARAMS', '1');
            const where = { objectName: 'crm_case', actionName: 'close_case_lax_probe' };
            expect(enforceActionParams(NO_DEPS, CLOSE, NO_OBJECT, { subject: 'x' }, where)).toBeNull();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]?.[0])).toContain('OS_ALLOW_LAX_ACTION_PARAMS=1');
        });
    });

    describe('[#27738] the `outputs.<key>` decision-output family is admitted for a forwarded `type: \'api\'` action only', () => {
        // ADR-0104 D2, amended 2026-10-30. The family is the one the api
        // request folds into its body's `outputs` (`buildApiActionRequest`), so
        // the admission reaches exactly as far as the fold and no further.
        const APPROVE = {
            name: 'approval_approve', type: 'api', target: '/api/v1/approvals/requests/{id}/approve',
            params: [
                { name: 'comment', type: 'textarea', required: false },
                { name: 'attachments', type: 'file', multiple: true, required: false },
            ],
        };
        const DECISION = { 'outputs.next_reviewers': ['u_2'], 'outputs.reason': 'fits budget', 'outputs.note': '' };

        it('admits the family beside the declared params', () => {
            expect(enforceActionParams(NO_DEPS, APPROVE, NO_OBJECT, { comment: 'ok', ...DECISION }, WHERE)).toBeNull();
        });

        it('still refuses every key outside the family, and the bare `outputs.` prefix, naming only those', () => {
            for (const key of ['bogus', 'outputs.', 'output.reason', 'outputs_reason']) {
                const error = enforceActionParams(NO_DEPS, APPROVE, NO_OBJECT, { ...DECISION, [key]: 'x' }, WHERE);
                expect(error, key).toContain(`Unknown action param "${key}"`);
                expect(error, key).not.toContain('outputs.next_reviewers');
            }
        });

        it('still judges the declared params themselves', () => {
            const error = enforceActionParams(NO_DEPS, APPROVE, NO_OBJECT, { attachments: 'not-a-list', ...DECISION }, WHERE);
            expect(error).toContain('"attachments"');
        });

        it('refuses the family on every action whose request does not fold it', () => {
            const notFolded = [
                { ...APPROVE, type: 'script' },
                { ...APPROVE, type: undefined },
                { ...APPROVE, type: 'flow' },
                // A declarative update writes its bag to the row: `operation` decides, whatever `type` says.
                { ...APPROVE, operation: 'update', patch: { status: 'approved' } },
                // Under `bodyShape.wrap` the params are nested and the fold never sees them.
                { ...APPROVE, bodyShape: { wrap: 'data' } },
            ];
            for (const action of notFolded) {
                const error = enforceActionParams(NO_DEPS, action, NO_OBJECT, { 'outputs.reason': 'x' }, WHERE);
                expect(error, JSON.stringify(action)).toContain('Unknown action param "outputs.reason"');
            }
        });

        it('a param an api action DECLARES under a dotted `outputs.` name is judged as declared', () => {
            const declared = { ...APPROVE, params: [...APPROVE.params, { name: 'outputs.reason', type: 'text', required: true }] };
            expect(enforceActionParams(NO_DEPS, declared, NO_OBJECT, {}, WHERE)).toContain('"outputs.reason" is required');
            expect(enforceActionParams(NO_DEPS, declared, NO_OBJECT, { 'outputs.reason': 'x' }, WHERE)).toBeNull();
        });
    });

    it('is STRICT by default — no environment variable needed to reject (#3438)', () => {
        vi.stubEnv('OS_ALLOW_LAX_ACTION_PARAMS', '');
        expect(enforceActionParams(NO_DEPS, REQUIRES_TITLE, NO_OBJECT, {}, WHERE)).toContain('Invalid action params');
    });

    it('`OS_ALLOW_LAX_ACTION_PARAMS=1` accepts the same bag instead, and warns', () => {
        // The opt-OUT of a check that ships ON (Prime Directive #9): the flag
        // must change the ANSWER, not merely the log line — a flag that only
        // logs would leave the rejection in place and strand the caller it was
        // added to unblock.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('OS_ALLOW_LAX_ACTION_PARAMS', '1');

        // A dedup key this suite has not warned on yet — `warnActionParamsOnce`
        // keys on `objectName/actionName` and its Set is module-global, so a
        // reused key would make the warn assertion pass or fail on test order.
        const where = { objectName: 'crm_lead', actionName: 'lax_probe' };
        expect(enforceActionParams(NO_DEPS, REQUIRES_TITLE, NO_OBJECT, {}, where)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('OS_ALLOW_LAX_ACTION_PARAMS=1');
    });
});
