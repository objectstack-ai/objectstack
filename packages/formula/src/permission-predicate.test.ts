// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { toEvalPermissions } from './eval-permissions';
import { firstUnknownFunctionCall } from './unknown-function';
import { validateExpression } from './validate';
import type { EvalContext, EvalResult } from './types';

/**
 * `current_user.can(object, verb)` — the permission predicate (objectui#4421,
 * maintainer ruling batch #147 item 5, letter A).
 *
 * ## The defect this file aims at
 *
 * Registering `can` ALONE makes the publish gate accept
 * `current_user.can(object, verb)` with zero errors while nothing can evaluate
 * it: the production evaluator receives `{ now, timezone, user, org, record }`
 * and `EvalUser` carries no permissions. The author's predicate then publishes
 * green and faults on every screen at runtime — one deduped `console.warn` as
 * the only signal, the action gone for every user including the one who holds
 * the grant.
 *
 * So the property under test is a PAIR, and neither half is optional:
 *
 *  - a `can` predicate that is given permission data **evaluates**, and
 *  - a `can` predicate that is not **fails loudly, at evaluation**, with a
 *    message naming the missing input — never `true`, never a silent `false`,
 *    never a green publish followed by a quiet wrong answer.
 *
 * The `expectLoud` helper below is what keeps the second half honest: it
 * asserts the refusal is a refusal (`ok: false`, `kind: 'runtime'`) rather than
 * merely "not the answer I wanted", which a silent `false` would also satisfy.
 */

/** The `/auth/me/permissions` `objects` payload used across these cases. */
const ME_PERMISSIONS = {
  crm_lead: { allowRead: true, allowEdit: true },
  crm_invoice: { allowRead: true },
  crm_audit: { viewAllRecords: true },
  crm_archive: { modifyAllRecords: true },
  crm_report: { allowRead: true, allowExport: true },
  crm_locked: {},
};

const USER = { id: 'usr_1', positions: ['sales_rep'], organizationId: 'org_1' };

function evaluate(source: string, ctx: EvalContext): EvalResult<boolean> {
  return celEngine.evaluate<boolean>({ dialect: 'cel', source }, ctx);
}

/** Evaluate with the standard subject + the standard effective permission map. */
function withPermissions(source: string): EvalResult<boolean> {
  return evaluate(source, { user: USER, permissions: toEvalPermissions(ME_PERMISSIONS) });
}

/**
 * Assert a refusal is LOUD: a reported `runtime` fault whose message contains
 * `needle`. ⛔ Never assert "the value was false" for these — a silent `false`
 * is the failure mode, so a pin that accepts one pins the defect.
 */
function expectLoud(result: EvalResult<boolean>, needle: string): void {
  expect(result.ok, 'must REFUSE, not answer').toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('runtime');
  expect(result.error.message).toContain(needle);
}

describe('`can` evaluates from permission data in the context', () => {
  it('answers TRUE for a granted verb and FALSE for an ungranted one on the same object', () => {
    // Both directions on one object: a pin that only asserted `true` would stay
    // green under an implementation that answers `true` for everything.
    expect(withPermissions("current_user.can('crm_lead', 'edit')")).toEqual({ ok: true, value: true });
    expect(withPermissions("current_user.can('crm_invoice', 'edit')")).toEqual({ ok: true, value: false });
  });

  it('reads the verb through the spec vocabulary, aliases included', () => {
    // `update` / `write` / `edit` all name `allowEdit`; `remove` names
    // `allowDelete`; `import` names `allowCreate` — the maintainer's own choice
    // (batch #13), not anything ADR-0068 says.
    expect(withPermissions("current_user.can('crm_lead', 'update')")).toEqual({ ok: true, value: true });
    expect(withPermissions("current_user.can('crm_lead', 'write')")).toEqual({ ok: true, value: true });
    expect(withPermissions("current_user.can('crm_lead', 'remove')")).toEqual({ ok: true, value: false });
    expect(withPermissions("current_user.can('crm_lead', 'import')")).toEqual({ ok: true, value: false });
  });

  it('agrees with the enforcement door about the super-user bits', () => {
    // `viewAllRecords` grants read, `modifyAllRecords` grants edit/delete — the
    // fold `PermissionEvaluator.checkObjectPermission` performs. A predicate
    // that answered `false` here would hide an action from the one caller the
    // server would have let through.
    expect(withPermissions("current_user.can('crm_audit', 'read')")).toEqual({ ok: true, value: true });
    expect(withPermissions("current_user.can('crm_archive', 'delete')")).toEqual({ ok: true, value: true });
    // …and the cell that is deliberately NOT folded: "Modify All Data" widens
    // edit/delete, it does not manufacture a create grant.
    expect(withPermissions("current_user.can('crm_archive', 'create')")).toEqual({ ok: true, value: false });
  });

  it('treats export as `grant ∧ read`, not as a bare bit', () => {
    expect(withPermissions("current_user.can('crm_report', 'export')")).toEqual({ ok: true, value: true });
    expect(withPermissions("current_user.can('crm_lead', 'export')")).toEqual({ ok: true, value: false });
  });

  it('answers FALSE for an object the effective map does not mention — a real answer, not a fault', () => {
    // An object no permission set mentions is an object with no grant, which is
    // what an all-`false` entry means too, so the two read the same. This is the
    // ONE quiet answer, and it is quiet because it is a fact about the data.
    expect(withPermissions("current_user.can('crm_unmentioned', 'read')")).toEqual({ ok: true, value: false });
    expect(withPermissions("current_user.can('crm_locked', 'read')")).toEqual({ ok: true, value: false });
  });

  it('answers identically under every ADR-0068 alias of the acting subject', () => {
    // `buildScope` mounts ONE EvalUser under four names; `can` compares the
    // receiver by identity, so all four reach it and a predicate evaluates the
    // same wherever it was authored.
    for (const root of ['current_user', 'user', 'ctx.user', 'os.user']) {
      expect(withPermissions(`${root}.can('crm_lead', 'edit')`), root)
        .toEqual({ ok: true, value: true });
    }
  });

  it('composes into a real visibility predicate', () => {
    // The authored shape the card exists for: "show this only if the user can
    // edit X" — the standing capability of every mainstream platform.
    expect(withPermissions("current_user.can('crm_lead', 'edit') && !current_user.can('crm_invoice', 'edit')"))
      .toEqual({ ok: true, value: true });
  });
});

describe('`can` refuses LOUDLY — never fail-open, never a silent false', () => {
  it('throws when the context carries NO permission data (ruling ②)', () => {
    // ⭐ The case the card exists to prevent. A predicate published green and
    // then handed the production context — `{ user }` and nothing else — must
    // say so, at evaluation, in words that name the missing input.
    const r = evaluate("current_user.can('crm_lead', 'edit')", { user: USER });
    expectLoud(r, 'carries no permission data');
    expectLoud(r, '/auth/me/permissions');
    // Stated as the two things it must NOT be, because both are values a
    // careless implementation returns and both are indistinguishable from a
    // real answer at the call site.
    expect(r).not.toEqual({ ok: true, value: true });
    expect(r).not.toEqual({ ok: true, value: false });
  });

  it('an EMPTY map is a real answer, not the missing-data fault', () => {
    // The boundary of the case above: a subject who holds nothing evaluates to
    // `false`. If these two collapsed, the loud refusal would fire for every
    // unprivileged caller and be trained away.
    expect(evaluate("current_user.can('crm_lead', 'edit')", { user: USER, permissions: {} }))
      .toEqual({ ok: true, value: false });
  });

  it('throws on a verb outside the vocabulary, and names the whole vocabulary', () => {
    const r = withPermissions("current_user.can('crm_lead', 'approve')");
    expectLoud(r, '`approve` is not a permission verb');
    expectLoud(r, 'create, delete, edit, export, import, read, remove, transfer, update, write');
  });

  it('throws on the retired lifecycle verbs rather than answering about a tombstone', () => {
    // `restore` / `purge` left the alias table with the #12497 tombstones, so
    // they are outside the derived vocabulary. Answering `false` would read as
    // "you lack the grant" for a bit that no longer exists.
    expectLoud(withPermissions("current_user.can('crm_lead', 'restore')"), 'is not a permission verb');
    expectLoud(withPermissions("current_user.can('crm_lead', 'purge')"), 'is not a permission verb');
  });

  it('throws on an inherited-property verb instead of resolving one', () => {
    // A plain record inherits `Object`'s own properties; a truthiness test on
    // `VERBS['toString']` says "granted". The own-property read is what stops it.
    expectLoud(withPermissions("current_user.can('crm_lead', 'toString')"), 'is not a permission verb');
    expectLoud(withPermissions("current_user.can('crm_lead', 'constructor')"), 'is not a permission verb');
  });

  it('throws when the receiver is not the acting subject', () => {
    // `record.can(…)` reads as a question about the record. Answering it from
    // the current user's permissions would be a confident wrong answer to a
    // question nobody asked.
    const r = evaluate("record.can('crm_lead', 'edit')", {
      user: USER,
      record: { id: 'r1' },
      permissions: toEvalPermissions(ME_PERMISSIONS),
    });
    expectLoud(r, 'answers about the ACTING SUBJECT');
  });

  it('throws on a non-string object or verb', () => {
    expectLoud(withPermissions('current_user.can(1, 2)'), 'must be an object NAME');
    expectLoud(withPermissions("current_user.can('crm_lead', 3)"), 'must be one of');
  });

  it('faults on an unbound `current_user` when the evaluation carries no user at all', () => {
    // A system write binds no user, so the receiver does not resolve and cel-js
    // refuses before the binding is reached. Loud either way — this pins WHICH
    // loud, so a later change that starts answering here is visible.
    const r = evaluate("current_user.can('crm_lead', 'edit')", {
      permissions: toEvalPermissions(ME_PERMISSIONS),
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.message).toContain('current_user');
  });
});

describe('`can` is registered RECEIVER-ONLY', () => {
  it('the bare call keeps faulting — a subject-less permission question has no meaning', () => {
    const compiled = celEngine.compile('can(object, verb)');
    expect(compiled.ok).toBe(false);
    expect(compiled.ok === false && compiled.error.kind).toBe('type');
    expect(compiled.ok === false && compiled.error.message)
      .toContain("found no matching overload for 'can(");
    // …and at evaluation too, with the data present: the fault is the call FORM,
    // not the data.
    expect(withPermissions('can(object, verb)').ok).toBe(false);
  });

  it('the name EXISTS even so, so the publish gate reports a call-form fault and not an unknown name', () => {
    // Same treatment the environment already gives `split`. Existence is not
    // call position (#13594 ruling refinement 3).
    expect(firstUnknownFunctionCall('can(object, verb)')).toBeNull();
    expect(firstUnknownFunctionCall('current_user.can(object, verb)')).toBeNull();
  });

  it('registration does not depend on the context that built the environment', () => {
    // The split this whole card exists to close: if `can` were registered only
    // when permission data happened to be present, a predicate could pass the
    // publish gate (which builds a data-free environment) and be an UNKNOWN name
    // at runtime, or the reverse. Both environments answer the same.
    expect(validateExpression('predicate', 'current_user.can(record, "read")').ok).toBe(true);
    expect(withPermissions("current_user.can('crm_lead', 'read')").ok).toBe(true);
  });
});

describe('toEvalPermissions — the door the map comes through', () => {
  it('carries the published payload through unchanged in meaning', () => {
    const map = toEvalPermissions(ME_PERMISSIONS);
    expect(Object.keys(map).sort()).toEqual(Object.keys(ME_PERMISSIONS).sort());
    expect(map.crm_lead.allowEdit).toBe(true);
  });

  it('refuses a payload that is not the published shape', () => {
    expect(() => toEvalPermissions(null)).toThrow(/expected the `objects` map/);
    expect(() => toEvalPermissions([])).toThrow(/received an array/);
    // A permission-set-shaped value in an entry, the classic hand-rolled map:
    // `allowEdit` as a string rather than a bool.
    expect(() => toEvalPermissions({ crm_lead: { allowEdit: 'yes' } }))
      .toThrow(/the entry for 'crm_lead' is not an EffectiveObjectPermission/);
    expect(() => toEvalPermissions({ crm_lead: 'read' })).toThrow(/crm_lead/);
  });

  it('accepts the retired-default residue the published 17.x toolchain still emits', () => {
    // A server on an older toolchain materialises `allowRestore: false` /
    // `allowPurge: false` into every entry. That residue must not make a whole
    // permission map unusable.
    const map = toEvalPermissions({ crm_lead: { allowRead: true, allowRestore: false, allowPurge: false } });
    expect(map.crm_lead.allowRead).toBe(true);
  });
});
