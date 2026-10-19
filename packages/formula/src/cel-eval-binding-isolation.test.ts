// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { buildEnv, celEngine } from './cel-engine';
import { toEvalPermissions } from './eval-permissions';
import { buildScope } from './stdlib';
import type { EvalContext, EvalResult } from './types';

/**
 * #24536 — `celEngine.evaluate` reuses one environment, and what used to be
 * fixed when that environment was built (`now`, the timezone and the
 * permission binding) is now bound per evaluation through a slot the stdlib
 * reads. These pins hold the slot to the rule that replaces "a fresh
 * environment per evaluation": a binding never outlives its evaluation.
 *
 *  - an evaluation with no subject, after one with a subject, answers
 *    `can` / `hasCapability` exactly as an environment built with no binding
 *    does — after a normal evaluation and after a thrown one;
 *  - an evaluation that runs INSIDE another (a scope value whose getter
 *    evaluates) leaves the outer binding exactly as it was, whether the inner
 *    one returns or throws.
 */

const PERMISSIONS = toEvalPermissions({ crm_lead: { allowRead: true } });
const ALICE = { id: 'usr_alice', positions: [] };
const BOB = { id: 'usr_bob', positions: [] };

function evaluate(source: string, ctx: EvalContext): EvalResult<unknown> {
  return celEngine.evaluate({ dialect: 'cel', source }, ctx);
}

/**
 * A receiver for an evaluation that binds no subject. With no `user` on the
 * context there is no `current_user` to call the predicates on, so the
 * question an unbound evaluation answers is asked on this one.
 */
const SOMEONE = { id: 'usr_alice', positions: [] };

/**
 * What an environment built with NO binding answers for `source` — the
 * stdlib's own throw, which `evaluate` reports as a `runtime` fault.
 */
function unboundAnswer(source: string): EvalResult<unknown> {
  try {
    return { ok: true, value: buildEnv(() => new Date(0)).evaluate(source, buildScope({ extra: { someone: SOMEONE } })) };
  } catch (err) {
    return { ok: false, error: { kind: 'runtime', message: (err as Error).message } };
  }
}

const CAN = "current_user.can('crm_lead', 'read')";
const HAS = "current_user.hasCapability('manage_users')";
const UNBOUND_CAN = "someone.can('crm_lead', 'read')";
const UNBOUND_HAS = "someone.hasCapability('manage_users')";

describe('#24536 — an evaluation with no subject after one with a subject', () => {
  it('the subject-bound evaluations answer (positive control)', () => {
    expect(evaluate(CAN, { user: ALICE, permissions: PERMISSIONS })).toEqual({ ok: true, value: true });
    expect(evaluate(HAS, { user: ALICE, systemPermissions: ['manage_users'] })).toEqual({ ok: true, value: true });
  });

  const UNBOUND_CTX: EvalContext = { permissions: PERMISSIONS, systemPermissions: ['manage_users'], extra: { someone: SOMEONE } };

  it.each([UNBOUND_CAN, UNBOUND_HAS])('answers %s as an unbound environment does', (source) => {
    const unbound = unboundAnswer(source);
    expect(unbound.ok).toBe(false);
    expect(unbound.ok === false && unbound.error.message).toContain('ACTING SUBJECT');
    expect(evaluate(CAN, { user: ALICE, permissions: PERMISSIONS })).toEqual({ ok: true, value: true });
    expect(evaluate(HAS, { user: ALICE, systemPermissions: ['manage_users'] })).toEqual({ ok: true, value: true });
    expect(evaluate(source, UNBOUND_CTX)).toEqual(unbound);
  });

  it.each([UNBOUND_CAN, UNBOUND_HAS])('answers %s as an unbound environment does after a THROWN evaluation', (source) => {
    const unbound = unboundAnswer(source);
    const thrown = evaluate("current_user.can('crm_lead', 'approve')", {
      user: ALICE, permissions: PERMISSIONS, systemPermissions: ['manage_users'],
    });
    expect(thrown.ok).toBe(false);
    expect(evaluate(source, UNBOUND_CTX)).toEqual(unbound);
  });
});

describe('#24536 — an evaluation nested inside another leaves the outer binding as it was', () => {
  /**
   * A record whose `probe` getter runs a whole evaluation for BOB (or one with
   * no subject at all) while ALICE's evaluation is reading it. `probe` is read
   * first, so every `can` / `hasCapability` / `now()` the outer source calls
   * runs after the inner evaluation has finished.
   */
  function probing(inner: () => void): Record<string, unknown> {
    return Object.defineProperty({}, 'probe', { enumerable: true, get: () => { inner(); return true; } });
  }

  const OUTER = `record.probe && ${CAN} && ${HAS}`;
  const aliceCtx = (record: Record<string, unknown>): EvalContext => ({
    record, user: ALICE, permissions: PERMISSIONS, systemPermissions: ['manage_users'],
  });

  it('after the inner evaluation returns', () => {
    let inner: EvalResult<unknown> | undefined;
    const record = probing(() => {
      inner = evaluate(CAN, { user: BOB, permissions: toEvalPermissions({}) });
    });
    expect(evaluate(OUTER, aliceCtx(record))).toEqual({ ok: true, value: true });
    expect(inner).toEqual({ ok: true, value: false });
  });

  it('after the inner evaluation throws', () => {
    let inner: EvalResult<unknown> | undefined;
    const record = probing(() => {
      inner = evaluate("current_user.can('crm_lead', 'approve')", { user: BOB, permissions: PERMISSIONS });
    });
    expect(evaluate(OUTER, aliceCtx(record))).toEqual({ ok: true, value: true });
    expect(inner?.ok).toBe(false);
  });

  it("after an inner evaluation with no subject, and the outer's now() and timezone too", () => {
    const outerNow = new Date('2026-03-01T20:00:00Z');
    const record = probing(() => {
      evaluate('today()', { now: new Date('1999-01-01T00:00:00Z') });
    });
    const r = evaluate(`record.probe && ${CAN} ? [now(), today()] : []`, {
      ...aliceCtx(record), now: outerNow, timezone: 'Asia/Shanghai',
    });
    // 20:00Z on 1 March is 2 March in Shanghai (UTC+8).
    expect(r).toEqual({ ok: true, value: [outerNow, new Date('2026-03-02T00:00:00Z')] });
  });
});

describe('#24536 — now and timezone are each evaluation\'s own', () => {
  it('alternating clocks and zones answer per evaluation', () => {
    const at = new Date('2026-03-01T20:00:00Z');
    for (let i = 0; i < 3; i++) {
      expect(evaluate('today()', { now: at, timezone: 'UTC' })).toEqual({ ok: true, value: new Date('2026-03-01T00:00:00Z') });
      expect(evaluate('today()', { now: at, timezone: 'Asia/Shanghai' })).toEqual({ ok: true, value: new Date('2026-03-02T00:00:00Z') });
      expect(evaluate('daysFromNow(1)', { now: new Date('2030-12-31T12:00:00Z') })).toEqual({ ok: true, value: new Date('2031-01-01T00:00:00Z') });
    }
  });
});
