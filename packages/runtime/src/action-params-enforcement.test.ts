// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `enforceActionParams` — the ADR-0104 D2 gate itself, not its validator
 * (#14864).
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

    it('passes an action that declares NO params straight through', () => {
        // The documented compatibility leg: nothing to validate against, so a
        // param-less action is untouched however odd its bag looks.
        expect(enforceActionParams(NO_DEPS, { name: 'ping' }, NO_OBJECT, { anything: 1 }, WHERE)).toBeNull();
        expect(enforceActionParams(NO_DEPS, { name: 'ping', params: [] }, NO_OBJECT, { anything: 1 }, WHERE)).toBeNull();
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
