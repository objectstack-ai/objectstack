// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { firstUnknownFunctionCall } from './unknown-function';
import { validateExpression } from './validate';
import type { EvalContext, EvalResult } from './types';

/**
 * `current_user.hasCapability(name)` — the capability predicate (cloud#3036
 * ruling A: the action's declaration is the one source of truth, so a page
 * predicate must be able to ask the question the action gate asks).
 *
 * The property under test is the same PAIR `permission-predicate.test.ts` pins
 * for `can`: given the subject's capability list the predicate evaluates, and
 * without it the predicate fails LOUDLY — never `true`, never a silent `false`.
 */

/** The `/auth/me/permissions` `systemPermissions` payload used across these cases. */
const SYSTEM_PERMISSIONS = ['manage_users', 'view_setup'];

const USER = { id: 'usr_1', positions: ['sales_rep'], organizationId: 'org_1' };

function evaluate(source: string, ctx: EvalContext): EvalResult<boolean> {
  return celEngine.evaluate<boolean>({ dialect: 'cel', source }, ctx);
}

function withCapabilities(source: string): EvalResult<boolean> {
  return evaluate(source, { user: USER, systemPermissions: SYSTEM_PERMISSIONS });
}

/** A refusal is a reported `runtime` fault naming `needle` — ⛔ never a quiet `false`. */
function expectLoud(result: EvalResult<boolean>, needle: string): void {
  expect(result.ok, 'must REFUSE, not answer').toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('runtime');
  expect(result.error.message).toContain(needle);
}

describe('`hasCapability` answers from the subject\'s held capabilities', () => {
  it('answers TRUE for a held capability and FALSE for one not held', () => {
    // Both directions: a pin asserting only `true` stays green under an
    // implementation that answers `true` for everything.
    expect(withCapabilities("current_user.hasCapability('manage_users')")).toEqual({ ok: true, value: true });
    expect(withCapabilities("current_user.hasCapability('manage_billing')")).toEqual({ ok: true, value: false });
  });

  it('treats a name no action declares as just a string — no registry lookup', () => {
    // Held ⇒ true, not held ⇒ false, whatever the platform's action catalog
    // says: the list is the subject's, and nothing else is consulted.
    const undeclared = 'zz_no_action_declares_this';
    expect(evaluate(`current_user.hasCapability('${undeclared}')`, {
      user: USER, systemPermissions: [undeclared],
    })).toEqual({ ok: true, value: true });
    expect(withCapabilities(`current_user.hasCapability('${undeclared}')`)).toEqual({ ok: true, value: false });
  });

  it('answers FALSE from an EMPTY list — a real answer, not a fault', () => {
    expect(evaluate("current_user.hasCapability('manage_users')", { user: USER, systemPermissions: [] }))
      .toEqual({ ok: true, value: false });
  });

  it('answers identically under every ADR-0068 alias of the acting subject', () => {
    for (const root of ['current_user', 'user', 'ctx.user', 'os.user']) {
      expect(withCapabilities(`${root}.hasCapability('manage_users')`), root).toEqual({ ok: true, value: true });
    }
  });

  it('composes with `can` and the rest of a predicate', () => {
    expect(evaluate(
      "current_user.hasCapability('view_setup') && !current_user.hasCapability('manage_billing')",
      { user: USER, systemPermissions: SYSTEM_PERMISSIONS },
    )).toEqual({ ok: true, value: true });
  });
});

describe('`hasCapability` refuses LOUDLY', () => {
  it('THROWS when the context carries no capability list — never a silent false', () => {
    expectLoud(
      evaluate("current_user.hasCapability('manage_users')", { user: USER }),
      'carries no capability list',
    );
  });

  it('THROWS on a capability list that is not a list of names', () => {
    expectLoud(
      evaluate("current_user.hasCapability('manage_users')", {
        user: USER,
        systemPermissions: { manage_users: true } as unknown as string[],
      }),
      'is not a list of capability names',
    );
  });

  it('THROWS when called on anything but the acting subject', () => {
    expectLoud(
      evaluate("record.hasCapability('manage_users')", {
        user: USER, systemPermissions: SYSTEM_PERMISSIONS, record: { id: 'r1' },
      }),
      'must be called on it',
    );
  });

  it('faults on an unbound `current_user` when the evaluation carries no user, even with a list', () => {
    // cel-js refuses the unresolved receiver before the binding is reached —
    // loud either way, as for `can`; this pins WHICH loud.
    const r = evaluate("current_user.hasCapability('manage_users')", { systemPermissions: SYSTEM_PERMISSIONS });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.message).toContain('current_user');
  });

  it('THROWS on a non-string or empty name', () => {
    expectLoud(withCapabilities('current_user.hasCapability(1)'), 'must be a system capability NAME');
    expectLoud(withCapabilities("current_user.hasCapability('')"), 'must be a system capability NAME');
  });

  it('a bare `hasCapability(name)` names no subject and does not resolve', () => {
    const result = withCapabilities("hasCapability('manage_users')");
    expect(result.ok).toBe(false);
  });
});

describe('`hasCapability` exists for the publish gates', () => {
  it('is a registered name — the function-existence oracle reports nothing', () => {
    expect(firstUnknownFunctionCall("current_user.hasCapability('manage_users')")).toBeNull();
    // Control: an invented sibling on the same receiver IS reported, so the
    // null above is a reading, not a blank run.
    expect(firstUnknownFunctionCall("current_user.hasCapabilities('manage_users')")?.name)
      .toBe('hasCapabilities');
  });

  it('validates clean as a boolean predicate', () => {
    expect(validateExpression('predicate', "current_user.hasCapability('manage_users')").ok).toBe(true);
  });

  it('points an out-of-vocabulary `can` verb at the capability predicate', () => {
    expectLoud(
      evaluate("current_user.can('crm_lead', 'approve')", { user: USER, permissions: {} }),
      "current_user.hasCapability('<name>')",
    );
  });
});
