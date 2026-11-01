// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28280 — Create User shows Email as required exactly when the endpoint
 * requires it.
 *
 * plugin-auth's Create User refuses a blank email with phone sign-in off (the
 * default), and accepts an email OR a phone number with it on. A param's
 * `required` is a static boolean, so the declaration carries TWO params on the
 * one `email` field, each gated on `features.phoneNumber`:
 *
 * - FIRST, the optional one, `requiresFeature: 'phoneNumber'` — shown beside
 *   Phone Number when phone sign-in is on. It is first because the feature-gate
 *   guard (`feature-gate-guard.test.ts`) resolves the booked path
 *   `sys_user.actions.create_user.params.email` to the first param with that
 *   field and wants the canonical opt-in gate as one of its conjuncts.
 * - SECOND, the required one, shown when the served config says phone sign-in
 *   is off. Its gate leads with `has(features.phoneNumber)` so that a console
 *   which has no served flag (the config not fetched yet, or a fetch that
 *   failed: the console's `features` is then `{}`) does not show it: a bare
 *   `features.phoneNumber != true` faults on the absent key, and the console
 *   shows a param whose gate faults, so both Email inputs would render.
 *
 * The console collects and submits only the params whose gate says yes
 * (`filterVisibleParams` in app-shell `ActionParamDialog.tsx`, whose own tests
 * pin that a fault shows the param). This file evaluates the declared gates
 * through the canonical engine under that rule, on the three `features`
 * bindings the console can hold, and asserts exactly one Email input with the
 * right `required` on each.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { featureGatePredicate } from '@objectstack/spec/kernel';
import { SysUser } from './sys-user.object.js';

type Param = { name?: string; field?: string; required?: boolean; visible?: { source?: string } };

const createUser = (SysUser.actions ?? []).find((a) => a.name === 'create_user');
const params = ((createUser as { params?: Param[] } | undefined)?.params ?? []) as Param[];
const keyOf = (p: Param) => p.name ?? p.field;

/** The console's rule: no gate, a gate answering true, or a gate that faults, shows the param. */
function shown(features: Record<string, unknown>): Param[] {
  return params.filter((p) => {
    const source = p.visible?.source;
    if (!source) return true;
    const r = celEngine.evaluate({ dialect: 'cel', source }, { record: {}, extra: { features } });
    return !r.ok || r.value === true;
  });
}

const emailsShown = (features: Record<string, unknown>) => shown(features).filter((p) => keyOf(p) === 'email');

describe('#28280 — Create User marks Email required exactly when the endpoint requires it', () => {
  it('phone sign-in off: one Email input, and it is required', () => {
    const emails = emailsShown({ phoneNumber: false });
    expect(emails).toHaveLength(1);
    expect(emails[0].required).toBe(true);
    expect(shown({ phoneNumber: false }).map(keyOf)).not.toContain('phoneNumber');
  });

  it('phone sign-in on: one Email input, optional, beside Phone Number', () => {
    const emails = emailsShown({ phoneNumber: true });
    expect(emails).toHaveLength(1);
    expect(emails[0].required).toBe(false);
    const keys = shown({ phoneNumber: true }).map(keyOf);
    expect(keys.indexOf('email')).toBeLessThan(keys.indexOf('phoneNumber'));
  });

  it('no served flag (config not fetched, or the fetch failed): one Email input, optional', () => {
    const emails = emailsShown({});
    expect(emails).toHaveLength(1);
    expect(emails[0].required).toBe(false);
  });

  it('the first Email param carries the canonical phoneNumber gate the feature-gate guard resolves', () => {
    const first = params.find((p) => keyOf(p) === 'email');
    expect(first?.required).toBe(false);
    expect(first?.visible?.source).toBe(featureGatePredicate('phoneNumber'));
  });
});
